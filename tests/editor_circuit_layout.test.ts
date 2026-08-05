// The circuit editor's shell: the action table every surface renders, and the
// layout it remembers between sessions.
//
// The table is pinned because four surfaces name the same actions (the menu bar,
// the tool rail, the status-bar chord hints and the cheatsheet) and the whole
// point of one table is that they cannot say different things. The layout is
// pinned because a stored panel geometry outlives the window it was stored from,
// and a dock parked off-screen is a panel nobody can close.

import { describe, expect, it } from 'vitest';
import {
  actionChord,
  actionForSelectionShortcut,
  actionForShortcut,
  actionTooltip,
  autoSideTab,
  CALLOUT_MIN_GAP,
  CALLOUT_REACH,
  calloutProblems,
  cheatBlocks,
  chordHints,
  clampDock,
  clampToolValue,
  clampZoom,
  DEFAULT_LAYOUT,
  DOCK_MIN_HEIGHT,
  DOCK_MIN_WIDTH,
  DOCK_SCRUB_STEPS,
  defaultDock,
  EDITOR_ACTIONS,
  editorAction,
  formatShortcut,
  GRID_YARDS,
  gridRange,
  gridStepAt,
  headlineChips,
  LAYOUT_STORAGE_KEY,
  MAX_CANVAS_CALLOUTS,
  MAX_GRID_LINES,
  MENU_ITEMS,
  MENUS,
  MODE_ACTIONS,
  menuActions,
  PREVIEW_READY_TITLES,
  PROBLEM_LABELS,
  parseLayout,
  problemDetail,
  problemHeadline,
  problemsChip,
  RAIL_ACTION_IDS,
  RAIL_MODES,
  railActions,
  railBanner,
  SIDE_TAB_LABELS,
  SIDE_TABS_MIN,
  serializeLayout,
  shortcutMatches,
  sideTabsFor,
  snapPoint,
  snapValue,
  spreadCallouts,
  TOOL_VALUE_FIELDS,
  toolFor,
  ZOOM_MAX_SCALE,
  ZOOM_MIN_SCALE,
  ZOOM_REFERENCE_SCALE,
  zoomPercent,
  zoomScale,
} from '../src/editor/circuit/layout_core';
import { REALM_RACERS_PRACTICE_CIRCUIT } from '../src/sim/content/realm_racers_circuits';
import {
  REALM_RACERS_RADIUS_OVER_WIDTH_FLOOR,
  REALM_RACERS_RADIUS_OVER_WIDTH_WARN,
  type RealmRacersCircuitProblem,
  realmRacersCircuitMetrics,
} from '../src/sim/realm_racers_circuit_metrics';
import { REALM_RACERS_MIN_HALF_WIDTH } from '../src/sim/realm_racers_layout';

const problem = (over: Partial<RealmRacersCircuitProblem> = {}): RealmRacersCircuitProblem => ({
  code: 'corner_folds_road',
  severity: 'error',
  value: 0.8,
  limit: 1,
  s: 120,
  ...over,
});

describe('the action table', () => {
  it('gives every action a label, a tooltip detail and an icon', () => {
    for (const action of EDITOR_ACTIONS) {
      expect(action.label.length, action.id).toBeGreaterThan(0);
      expect(action.detail.length, action.id).toBeGreaterThan(0);
      expect(action.icon.length, action.id).toBeGreaterThan(0);
    }
  });

  it('has no duplicate ids', () => {
    const ids = EDITOR_ACTIONS.map((action) => action.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every action a way to be invoked: a chord, a gesture, or a menu', () => {
    for (const action of EDITOR_ACTIONS) {
      const reachable = Boolean(action.shortcut) || Boolean(action.gesture) || Boolean(action.menu);
      expect(reachable, action.id).toBe(true);
    }
  });

  it('lists each menu-tagged action in exactly one menu, and nothing else', () => {
    const listed = MENUS.flatMap((menu) => MENU_ITEMS[menu.id]);
    expect(new Set(listed).size).toBe(listed.length);
    for (const action of EDITOR_ACTIONS) {
      if (action.menu) expect(MENU_ITEMS[action.menu], action.id).toContain(action.id);
      else expect(listed, action.id).not.toContain(action.id);
    }
  });

  it('hands the menu bar the defs in the order the menu lists them', () => {
    // The shell builds its menus off `menuActions`, not off `MENU_ITEMS`: a bug
    // there would render the right ids in the wrong order, or throw on a row
    // nobody added, and neither shows up in a check of the table alone.
    for (const menu of MENUS) {
      const defs = menuActions(menu.id);
      expect(defs.map((def) => def.id)).toEqual([...MENU_ITEMS[menu.id]]);
      for (const def of defs) expect(def.menu, def.id).toBe(menu.id);
    }
  });

  it('names one action per rail mode, and one rail mode per digit', () => {
    for (const mode of RAIL_MODES) {
      const action = editorAction(MODE_ACTIONS[mode.id]);
      expect(action.shortcut).toBe(mode.shortcut);
    }
    const digits = RAIL_MODES.map((mode) => mode.shortcut);
    expect(digits).toEqual(['1', '2', '3', '4', '5']);
  });

  it('throws on an id the table does not carry, rather than returning undefined', () => {
    // The menus and the rail index the table by id; a row someone forgot must
    // fail loudly at build-up rather than render a blank button.
    expect(() => editorAction('nope' as never)).toThrow();
  });

  it('puts every chord-or-gesture action in exactly one cheatsheet block', () => {
    const rows = cheatBlocks('other').flatMap((block) => block.rows);
    const invocable = EDITOR_ACTIONS.filter((action) => action.shortcut || action.gesture);
    expect(rows).toHaveLength(invocable.length);
    for (const action of invocable) {
      expect(rows.filter((row) => row.label === action.label)).toHaveLength(1);
    }
  });

  it('opens the cheatsheet on the blocks an operator reaches for, in that order', () => {
    // Membership was pinned and ORDER was not, so the overlay could have opened
    // on File while the tools an operator is actually hunting for sat last. The
    // order is the design: what the hands are doing, then the document.
    const blocks = cheatBlocks('other');
    expect(blocks.map((block) => block.group)).toEqual([
      'tools',
      'selection',
      'canvas',
      'file',
      'edit',
      'view',
    ]);
    expect(blocks.map((block) => block.label)).toEqual([
      'Tools',
      'Selection',
      'Canvas',
      'File',
      'Edit',
      'View',
    ]);
    // TRACK is absent, and that is the filter working rather than a gap: every
    // repair is a menu entry and a plan chip with no chord at all, so a Track
    // heading would sit over nothing. Pinned, so giving one a shortcut has to
    // come back through here.
    expect(EDITOR_ACTIONS.filter((action) => action.group === 'track').length).toBeGreaterThan(0);
    expect(
      EDITOR_ACTIONS.some(
        (action) => action.group === 'track' && (action.shortcut || action.gesture),
      ),
    ).toBe(false);
    // Every block that survives the filter has rows: an empty titled block is a
    // heading over nothing.
    for (const block of blocks) expect(block.rows.length, block.group).toBeGreaterThan(0);
  });

  it('prints the status-bar hints as chord plus verb, one per hinted row', () => {
    const hints = chordHints('other');
    expect(hints).toContain('ctrl+Z undo');
    expect(hints).toContain('R rotate');
    expect(hints).toContain('wheel zoom');
    expect(hints).toContain('middle-drag pan');
    expect(hints).toContain('shift+R flip direction');
    // Length pinned against the table's own `hint` rows: a hint added without a
    // line here would be an unasserted string on screen.
    expect(hints).toHaveLength(EDITOR_ACTIONS.filter((action) => action.hint).length);
    expect(hints).toHaveLength(5);
    expect(chordHints('mac')).toContain('cmd+Z undo');
  });

  it('names both the action and the way to reach it in a tooltip', () => {
    const tooltip = actionTooltip(editorAction('undo'), 'other');
    expect(tooltip).toContain('Undo');
    expect(tooltip).toContain('ctrl+Z');
    // A pointer gesture prints its gesture, not an empty chord.
    expect(actionChord(editorAction('panView'), 'mac')).toBe('middle-drag');
  });

  it('drops the parentheses for an action with no way to reach it but the menu', () => {
    // The uncovered arm: `New blank` carries neither a chord nor a gesture, and
    // the tooltip has to read as a sentence rather than as "New blank (): ...".
    const action = editorAction('newBlank');
    expect(action.shortcut).toBeUndefined();
    expect(action.gesture).toBeUndefined();
    expect(actionChord(action, 'other')).toBe('');
    expect(actionTooltip(action, 'other')).toBe(`${action.label}: ${action.detail}`);
    expect(actionTooltip(action, 'other')).not.toContain('(');
  });
});

describe('the constants the chrome reads back', () => {
  it('clamps the tool value into the active field range, and refuses a non-number', () => {
    // Not a pure extraction: the shell's old inline expression let an emptied
    // box reach `Math.max(min, NaN)` and write the string "NaN" into the input.
    const field = TOOL_VALUE_FIELDS.width;
    expect(field).not.toBeNull();
    if (!field) return;
    expect(clampToolValue(field, field.min - 5)).toBe(field.min);
    expect(clampToolValue(field, field.max + 5)).toBe(field.max);
    expect(clampToolValue(field, field.min + 1)).toBe(field.min + 1);
    expect(clampToolValue(field, Number.NaN)).toBe(field.min);
    expect(clampToolValue(field, Number.POSITIVE_INFINITY)).toBe(field.min);
  });

  it('divides the lap into the scrubber steps the markup no longer names', () => {
    expect(DOCK_SCRUB_STEPS).toBe(1000);
  });

  it('drops the tab strip below two tabs rather than showing a click that decides nothing', () => {
    expect(SIDE_TABS_MIN).toBe(2);
    // And the one mode that has tabs really does clear the bar, or the constant
    // would be pinning a strip nothing ever shows.
    expect(sideTabsFor('props').length).toBeGreaterThanOrEqual(SIDE_TABS_MIN);
  });

  it('gives the preview dot one sentence per state, and never the wrong one', () => {
    // Three operator-visible strings that moved out of the shell into a core; the
    // regression the table exists to stop is `error` and `off` drifting apart.
    expect(PREVIEW_READY_TITLES).toEqual({
      ready: 'the 3D preview is live on this record',
      error: 'the 3D preview could not start',
      off: 'the 3D preview is not open',
    });
  });
});

describe('which tab a mode opens on', () => {
  it('follows the selection, EXCEPT while a piece is armed', () => {
    // Every placement selects what it just placed, so following the selection
    // took the library away after every single drop. A placing loop stays where
    // the tiles are; the inspector is one click, or one esc, away.
    expect(autoSideTab('props', false)).toBe('library');
    expect(autoSideTab('props', true)).toBe('inspector');
    expect(autoSideTab('props', true, true)).toBe('library');
    expect(autoSideTab('props', false, true)).toBe('library');
    // The RACE tool has a palette now, so the same loop holds there.
    expect(autoSideTab('race', true, true)).toBe('library');
    expect(autoSideTab('race', false, true)).toBe('library');
    // A mode with no tabs has nothing to open on, armed or not.
    expect(autoSideTab('width', true, true)).toBeNull();
  });

  it('opens on the library in every mode that HAS one, whatever else it offers', () => {
    // The rule is spelled by NAME in `autoSideTab` rather than as `tabs[0]`.
    // Both spellings agree on today's two orders, since the library leads both,
    // so this cannot fail on the current table and is not claimed to: what it
    // pins is the premise the positional form silently depended on. Break the
    // order and the naming keeps the loop; break the naming and this is the row
    // that says which mode stopped opening where the tiles are.
    for (const mode of RAIL_MODES) {
      const tabs = sideTabsFor(mode.id);
      if (!tabs.includes('library')) continue;
      expect(tabs[0], `${mode.id} leads with the library`).toBe('library');
      expect(autoSideTab(mode.id, true, true), mode.id).toBe('library');
    }
  });
});

describe('shortcut matching', () => {
  it('is exact about the modifier keys', () => {
    expect(shortcutMatches('mod+z', { key: 'z', ctrlKey: true })).toBe(true);
    expect(shortcutMatches('mod+z', { key: 'z', metaKey: true })).toBe(true);
    expect(shortcutMatches('mod+z', { key: 'z' })).toBe(false);
    expect(shortcutMatches('mod+z', { key: 'z', ctrlKey: true, shiftKey: true })).toBe(false);
    expect(shortcutMatches('mod+shift+z', { key: 'z', ctrlKey: true, shiftKey: true })).toBe(true);
    expect(shortcutMatches('r', { key: 'R', shiftKey: true })).toBe(false);
    expect(shortcutMatches('shift+r', { key: 'R', shiftKey: true })).toBe(true);
  });

  it('ignores shift on a punctuation key, which IS a shifted key on most layouts', () => {
    // The bug this pins: `?` only exists as shift+/, so comparing shift exactly
    // meant the cheatsheet chord could never fire.
    expect(shortcutMatches('?', { key: '?', shiftKey: true })).toBe(true);
    expect(shortcutMatches('+', { key: '+', shiftKey: true })).toBe(true);
    expect(shortcutMatches('+', { key: '=' })).toBe(true);
  });

  it('matches a digit on the PHYSICAL key, because AZERTY shifts the digit row', () => {
    // The bug this pins: on a French keyboard the `1` key reports `&`, and `1`
    // only ever arrives with shift held, so the rail's 1..4 were simply dead.
    expect(shortcutMatches('3', { key: '"', code: 'Digit3' })).toBe(true);
    expect(shortcutMatches('3', { key: '3', code: 'Digit3', shiftKey: true })).toBe(true);
    // QWERTY still works, and a different digit still does not match.
    expect(shortcutMatches('3', { key: '3', code: 'Digit3' })).toBe(true);
    expect(shortcutMatches('3', { key: '4', code: 'Digit4' })).toBe(false);
    // The physical arm never overrides a modifier the spec does not ask for.
    expect(shortcutMatches('3', { key: '3', code: 'Digit3', ctrlKey: true })).toBe(false);
    expect(shortcutMatches('3', { key: '3', code: 'Digit3', altKey: true })).toBe(false);
    // A layout that reports no code at all still resolves on the key.
    expect(shortcutMatches('3', { key: '3' })).toBe(true);
  });

  it('resolves the rail digits whichever keyboard they arrive from', () => {
    expect(actionForShortcut({ key: '&', code: 'Digit1' })).toBe('modeShape');
    expect(actionForShortcut({ key: 'é', code: 'Digit2' })).toBe('modeWidth');
    expect(actionForShortcut({ key: "'", code: 'Digit4' })).toBe('modeRace');
    expect(actionForShortcut({ key: 'à', code: 'Digit0' })).toBe('fitView');
  });

  it('refuses a chord with alt held, which is nothing in this table', () => {
    expect(shortcutMatches('g', { key: 'g', altKey: true })).toBe(false);
  });

  it('treats backspace as delete', () => {
    expect(shortcutMatches('delete', { key: 'Backspace' })).toBe(true);
  });

  it('resolves only GLOBAL actions, leaving the selection keys to the props tool', () => {
    expect(actionForShortcut({ key: '3' })).toBe('modeProps');
    expect(actionForShortcut({ key: 'z', ctrlKey: true })).toBe('undo');
    expect(actionForShortcut({ key: 'f', shiftKey: true })).toBe('dockFullscreen');
    // `r`, `c`, `+`, `-` and delete only mean anything with a piece selected.
    expect(actionForShortcut({ key: 'r' })).toBeNull();
    expect(actionForShortcut({ key: 'c' })).toBeNull();
    expect(actionForShortcut({ key: 'Delete' })).toBeNull();
    expect(actionForShortcut({ key: 'q' })).toBeNull();
  });

  it('resolves the selection chords, and only when a selection is what is meant', () => {
    expect(actionForSelectionShortcut({ key: 'r' })).toBe('rotateProp');
    expect(actionForSelectionShortcut({ key: 'r', shiftKey: true })).toBe('faceRacing');
    expect(actionForSelectionShortcut({ key: 'd', ctrlKey: true })).toBe('duplicateSelection');
    expect(actionForSelectionShortcut({ key: 'd', metaKey: true })).toBe('duplicateSelection');
    expect(actionForSelectionShortcut({ key: 'f' })).toBe('focusSelection');
    // A bare `d` is not the duplicate: the chord carries the modifier.
    expect(actionForSelectionShortcut({ key: 'd' })).toBeNull();
    // And a global chord never comes back out of the selection resolver.
    expect(actionForSelectionShortcut({ key: 's', ctrlKey: true })).toBeNull();
  });

  it('keeps focus and the dock fullscreen apart, which differ only by shift', () => {
    // `f` focuses the selection, `shift+f` blows the dock up. The global
    // resolver runs first in the page, so the two must not both answer.
    expect(actionForShortcut({ key: 'f' })).toBeNull();
    expect(actionForShortcut({ key: 'f', shiftKey: true })).toBe('dockFullscreen');
    expect(actionForSelectionShortcut({ key: 'f', shiftKey: true })).toBeNull();
  });

  it('leaves the arrow nudge to the page, and says so with a gesture instead', () => {
    // A chord row per arrow, doubled for the shifted step, is eight cheatsheet
    // rows for one gesture; the page matches the keys off `nudgeKeyOf`. What the
    // table owes is the ONE line an operator reads, and a row with no shortcut
    // must not be resolvable as one.
    const nudge = editorAction('nudgeSelection');
    expect(nudge.shortcut).toBeUndefined();
    expect(nudge.gesture).toBeTruthy();
    expect(nudge.scope).toBe('selection');
    for (const key of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) {
      expect(actionForSelectionShortcut({ key }), key).toBeNull();
      expect(actionForShortcut({ key }), key).toBeNull();
    }
  });

  it('names the space bar, which cannot be written as a chord character', () => {
    expect(shortcutMatches('space', { key: ' ' })).toBe(true);
    expect(shortcutMatches('space', { key: ' ', ctrlKey: true })).toBe(false);
    expect(actionForShortcut({ key: ' ' })).toBe('dockPlay');
    expect(formatShortcut('space', 'other')).toBe('space');
  });

  it('spells a chord the operator platform way', () => {
    expect(formatShortcut('mod+s', 'mac')).toBe('cmd+S');
    expect(formatShortcut('mod+s', 'other')).toBe('ctrl+S');
    expect(formatShortcut('delete', 'other')).toBe('del');
    expect(formatShortcut('shift+f', 'other')).toBe('shift+F');
    expect(formatShortcut('?', 'other')).toBe('?');
  });
});

describe('the rail', () => {
  it('resolves SHAPE into drawing a blank canvas and editing a drawn one', () => {
    expect(toolFor('shape', false)).toBe('draw');
    expect(toolFor('shape', true)).toBe('handles');
    expect(toolFor('props', false)).toBe('props');
    expect(railBanner('shape', false)).not.toBe(railBanner('shape', true));
  });

  it('gives every tool its own banner, so none silently inherits another', () => {
    const banners = new Set<string>();
    for (const [mode, drawn] of [
      ['shape', false],
      ['shape', true],
      ['width', true],
      ['props', true],
      ['race', true],
    ] as const) {
      const line = railBanner(mode, drawn);
      expect(line.length, `${mode}/${drawn}`).toBeGreaterThan(0);
      banners.add(line);
    }
    // Five tools, five sentences: a new one falling into the default arm and
    // wearing the race text would collapse this set.
    expect(banners.size).toBe(5);
  });

  it('says which placement gesture PROPS is waiting for, one sentence each', () => {
    // The visible half of the placement block. Without this the whole ternary
    // could go back to one sentence describing all three modes at once, which is
    // the tool refusing to say what it is about to do.
    const say = (placement: 'single' | 'scatter' | 'alongRoad') =>
      railBanner('props', true, false, placement);
    expect(new Set([say('single'), say('scatter'), say('alongRoad')]).size).toBe(3);
    expect(say('single')).toContain('drag a tile');
    expect(say('single')).toContain('alt');
    expect(say('scatter')).toContain('box');
    expect(say('alongRoad')).toContain('ALONG');
    expect(say('alongRoad')).toContain('spacing');
    // The default is the one an operator meets first.
    expect(railBanner('props', true)).toBe(say('single'));
    // ...and it changes nothing for a tool that has no placement to speak of.
    expect(railBanner('width', true, false, 'alongRoad')).toBe(railBanner('width', true));
  });

  it('says which of TERRAIN’s two gestures is armed, one sentence each', () => {
    // The tool has two drawing gestures and they are nothing alike: a barrier is
    // dropped point by point and the ground is one closed stroke. The banner
    // carried the barrier sentence with the ground as a tail clause, which is
    // the banner refusing to say what the next drag will do.
    const pointer = railBanner('terrain', true);
    const drawingFence = railBanner('terrain', true, false, 'single', true);
    const drawingGround = railBanner('terrain', true, false, 'single', false, true);
    expect(new Set([pointer, drawingFence, drawingGround]).size).toBe(3);
    expect(drawingGround).toContain('closed loop');
    expect(drawingGround).not.toContain('point');
    expect(drawingFence).toContain('close the ring');
    // The ground wins over an armed kit, because arming one disarms the other:
    // a sentence describing both would describe a state the tool cannot be in.
    expect(railBanner('terrain', true, false, 'single', true, true)).toBe(drawingGround);
    // ...and it says nothing at all in another tool, where no ground is armed.
    expect(railBanner('props', true, false, 'single', false, true)).toBe(railBanner('props', true));
  });

  it('says something different while re-stroking a drawn circuit', () => {
    expect(railBanner('shape', true, true)).not.toBe(railBanner('shape', true));
    expect(railBanner('shape', true, true)).toContain('stay');
    expect(toolFor('shape', true, true)).toBe('draw');
    expect(toolFor('shape', true, false)).toBe('handles');
  });

  it('gives the strip to the one tool that paints a number, and nobody else', () => {
    expect(TOOL_VALUE_FIELDS.width?.label).toContain('half-width');
    expect(TOOL_VALUE_FIELDS.draw).toBeNull();
    expect(TOOL_VALUE_FIELDS.handles).toBeNull();
    expect(TOOL_VALUE_FIELDS.race).toBeNull();
    // PROPS lost its field to the library. The spacing means nothing without the
    // placement MODE and the two toggles beside it, and a copy in the tool strip
    // would be a second box holding the same number.
    expect(TOOL_VALUE_FIELDS.props).toBeNull();
    // The road's floor is the SIM's floor, not a second opinion: the tool must
    // not offer a road narrower than the game will drive.
    expect(TOOL_VALUE_FIELDS.width?.min).toBe(REALM_RACERS_MIN_HALF_WIDTH);
    expect(TOOL_VALUE_FIELDS.width?.max).toBeGreaterThan(REALM_RACERS_MIN_HALF_WIDTH);
  });

  it('puts a mode repair on the plan, and only where it means something', () => {
    // The defect: both repairs lived in the Track menu alone, and an operator who
    // had just finished a stroke could not find either.
    expect(railActions('shape')).toContain('fitEnclosure');
    expect(railActions('shape')).toContain('fixCorners');
    // fixCorners narrows the ROAD to clear a corner the CURVE made, so it is both
    // shaping tools' business.
    expect(railActions('width')).toEqual(['fixCorners']);
    expect(railActions('props')).toEqual([]);
    // TERRAIN is read as one intent, the land the race sits on, so every action
    // about that land is on its banner, the GROUND first and the enclosure
    // after: draw the shape, fit one to the road, discard it, then size and
    // centre the boxes around it. `fitEnclosure` is on SHAPE as well,
    // deliberately, and an action appearing on two banners is still one row in
    // the table.
    expect(railActions('terrain')).toEqual([
      'drawGround',
      'fitGround',
      'deleteGround',
      'fitEnclosure',
      'centerCircuit',
    ]);
    for (const mode of RAIL_MODES) {
      for (const id of railActions(mode.id)) {
        // Every one is a real action, with a menu home as well as a plan button.
        expect(editorAction(id).menu, id).toBe('track');
        expect(RAIL_ACTION_IDS, id).toContain(id);
      }
    }
  });

  it('names each plan-repair button once, so the chrome can build it once', () => {
    expect(new Set(RAIL_ACTION_IDS).size).toBe(RAIL_ACTION_IDS.length);
    const used = new Set(RAIL_MODES.flatMap((mode) => railActions(mode.id)));
    expect([...RAIL_ACTION_IDS].sort()).toEqual([...used].sort());
  });

  it('labels every tab any mode can offer', () => {
    const offered = new Set(RAIL_MODES.flatMap((mode) => sideTabsFor(mode.id)));
    for (const tab of offered) expect(SIDE_TAB_LABELS[tab]?.length, tab).toBeGreaterThan(0);
    // Both ways: a label for a tab nothing offers is dead.
    for (const tab of Object.keys(SIDE_TAB_LABELS)) expect([...offered], tab).toContain(tab);
  });

  it('offers a mode only the tabs it can actually use', () => {
    // The defect: all three tabs everywhere put two dead ones in front of the
    // operator in shape and width, where nothing arms a piece and nothing is
    // selectable.
    // The props tabs arm or edit a piece of DRESSING, so they are dead in a tool
    // that places none. The regression this pins: shape and width kept the
    // outliner, which listed props at an operator painting a road.
    expect(sideTabsFor('props')).toEqual(['library', 'inspector', 'outliner']);
    expect(sideTabsFor('shape')).toEqual([]);
    expect(sideTabsFor('width')).toEqual([]);
    // RACE places furniture, so it has a palette and an inspector of its own,
    // plus the record form as a tab: a tab owns the WHOLE column, and the form
    // used to be the one panel here that sat outside the strip.
    expect(sideTabsFor('race')).toEqual(['library', 'inspector', 'properties']);
  });

  it('keeps Library and Inspector in the same position in both placing tools', () => {
    // Not cosmetic: the two tools are switched between constantly, and a tab
    // that changes place between them is one the eye has to re-find every time.
    // `properties` is appended for that reason rather than led with.
    const props = sideTabsFor('props');
    const race = sideTabsFor('race');
    expect(race.indexOf('library')).toBe(props.indexOf('library'));
    expect(race.indexOf('inspector')).toBe(props.indexOf('inspector'));
  });

  it('gives the record form a tab of its own and no other mode a Properties tab', () => {
    for (const mode of RAIL_MODES) {
      expect(sideTabsFor(mode.id).includes('properties'), mode.id).toBe(mode.id === 'race');
    }
  });

  it('opens the panel on the library while placing and the inspector over a selection', () => {
    expect(autoSideTab('props', false)).toBe('library');
    expect(autoSideTab('props', true)).toBe('inspector');
    // Nothing to open in a mode with no tabs, selection or not: what shows there
    // is the mode readout, which is not a tab.
    expect(autoSideTab('shape', false)).toBeNull();
    expect(autoSideTab('shape', true)).toBeNull();
    expect(autoSideTab('width', true)).toBeNull();
    // RACE now has tabs of its own, and reads the same way PROPS does.
    expect(autoSideTab('race', false)).toBe('library');
    expect(autoSideTab('race', true)).toBe('inspector');
  });

  it('only ever auto-picks a tab the mode offers', () => {
    for (const mode of RAIL_MODES) {
      const auto = autoSideTab(mode.id, false);
      const withSelection = autoSideTab(mode.id, true);
      const tabs = sideTabsFor(mode.id);
      if (auto) expect(tabs, mode.id).toContain(auto);
      if (withSelection) expect(tabs, mode.id).toContain(withSelection);
      expect(auto === null, mode.id).toBe(tabs.length === 0);
    }
  });
});

describe('the persisted layout', () => {
  it('answers the default for nothing, for rubbish, and for a foreign version', () => {
    expect(parseLayout(null)).toEqual(DEFAULT_LAYOUT);
    expect(parseLayout('{oh no')).toEqual(DEFAULT_LAYOUT);
    expect(parseLayout('42')).toEqual(DEFAULT_LAYOUT);
    expect(parseLayout(JSON.stringify({ version: 99, grid: false }))).toEqual(DEFAULT_LAYOUT);
  });

  it('round-trips through its own serializer', () => {
    const layout = {
      ...DEFAULT_LAYOUT,
      dock: { left: 30, top: 40, width: 500, height: 300 },
      dockOpen: true,
      followCursor: true,
      metricsOpen: true,
      dockFullscreen: true,
      invertLook: true,
      grid: false,
      snap: true,
      zoom: 3.5,
      side: 'outliner' as const,
    };
    expect(parseLayout(serializeLayout(layout))).toEqual(layout);
  });

  it('drops a field of the wrong type back to its default instead of carrying it', () => {
    // `dockOpen: true` is VALID and non-default, and it has to survive: without a
    // good field in the payload this test would pass on `parseLayout` rejecting
    // the whole object for any reason at all, version included.
    const parsed = parseLayout(
      JSON.stringify({ version: 1, dockOpen: true, grid: 'yes', zoom: -3, side: 'nope', dock: 7 }),
    );
    expect(parsed.dockOpen).toBe(true);
    expect(parsed.grid).toBe(DEFAULT_LAYOUT.grid);
    expect(parsed.zoom).toBeNull();
    expect(parsed.side).toBe(DEFAULT_LAYOUT.side);
    expect(parsed.dock).toBeNull();
  });

  it('keys the store under one versioned name', () => {
    expect(LAYOUT_STORAGE_KEY).toBe('woc_circuit_editor_layout_v1');
  });
});

describe('the dock geometry', () => {
  const area = { width: 1200, height: 800 };

  it('opens an unplaced dock inside the plan, at the bottom right', () => {
    const dock = defaultDock(area);
    expect(dock.left + dock.width).toBeLessThanOrEqual(area.width);
    expect(dock.top + dock.height).toBeLessThanOrEqual(area.height);
    expect(dock.left).toBeGreaterThan(area.width / 2);
    expect(dock.top).toBeGreaterThan(area.height / 2);
  });

  it('pulls a dock stored on a bigger monitor back into view', () => {
    // The failure this exists for: a panel parked bottom right on a wide screen
    // is entirely off a laptop, and a panel nobody can reach cannot be closed.
    const clamped = clampDock({ left: 1900, top: 1200, width: 600, height: 400 }, area);
    expect(clamped.left + clamped.width).toBeLessThanOrEqual(area.width);
    expect(clamped.top + clamped.height).toBeLessThanOrEqual(area.height);
    expect(clamped.left).toBeGreaterThanOrEqual(0);
    expect(clamped.top).toBeGreaterThanOrEqual(0);
  });

  it('pulls a dock dragged off the top or the left edge back into view', () => {
    // The low side of the same clamp. Without it, a window resized smaller can
    // leave the header, and so the close button, above the plan.
    const clamped = clampDock({ left: -500, top: -300, width: 400, height: 300 }, area);
    expect(clamped.left).toBe(0);
    expect(clamped.top).toBe(0);
    expect(clamped.width).toBe(400);
    expect(clamped.height).toBe(300);
  });

  it('opens an unplaced dock at a non-negative origin even on a tiny plan', () => {
    const dock = defaultDock({ width: 100, height: 80 });
    expect(dock.left).toBeGreaterThanOrEqual(0);
    expect(dock.top).toBeGreaterThanOrEqual(0);
  });

  it('keeps it big enough to read, and never bigger than the plan', () => {
    const tiny = clampDock({ left: 0, top: 0, width: 10, height: 10 }, area);
    expect(tiny.width).toBe(DOCK_MIN_WIDTH);
    expect(tiny.height).toBe(DOCK_MIN_HEIGHT);
    const huge = clampDock({ left: 0, top: 0, width: 9000, height: 9000 }, area);
    expect(huge.width).toBe(area.width);
    expect(huge.height).toBe(area.height);
  });

  it('survives a plan smaller than the dock minimum without going negative', () => {
    const cramped = clampDock(
      { left: 5, top: 5, width: 400, height: 300 },
      { width: 80, height: 60 },
    );
    expect(cramped.left).toBe(0);
    expect(cramped.top).toBe(0);
    expect(cramped.width).toBe(DOCK_MIN_WIDTH);
    expect(cramped.height).toBe(DOCK_MIN_HEIGHT);
  });
});

describe('zoom, grid and snap', () => {
  it('calls the reference scale 100 percent, both ways', () => {
    expect(zoomPercent(ZOOM_REFERENCE_SCALE)).toBe(100);
    expect(zoomScale(100)).toBeCloseTo(ZOOM_REFERENCE_SCALE);
    expect(zoomPercent(zoomScale(50))).toBe(50);
    expect(zoomPercent(zoomScale(200))).toBe(200);
  });

  it('pins the zoom band to literals, so the constants cannot drift unnoticed', () => {
    // The band is compared against itself everywhere else, which protects that a
    // clamp EXISTS and not what it clamps to.
    expect(ZOOM_MIN_SCALE).toBe(0.4);
    expect(ZOOM_MAX_SCALE).toBe(20);
    expect(ZOOM_REFERENCE_SCALE).toBe(2.4);
  });

  it('refuses a stored zoom that is not a finite number in the band', () => {
    // The hole this closes: `JSON.parse('{"zoom":1e999}')` is Infinity, which
    // passed a bare `> 0` test and reached `view.scale`, turning every screen
    // coordinate into Infinity and opening the page blank.
    expect(clampZoom(Number.POSITIVE_INFINITY)).toBeNull();
    expect(clampZoom(Number.NaN)).toBeNull();
    expect(clampZoom(0)).toBeNull();
    expect(clampZoom(-3)).toBeNull();
    expect(clampZoom('4')).toBeNull();
    expect(clampZoom(undefined)).toBeNull();
    // A finite one comes back inside the band the plan can draw at.
    expect(clampZoom(3)).toBe(3);
    expect(clampZoom(9999)).toBe(ZOOM_MAX_SCALE);
    // The raw stored text, not a literal: this is what a corrupt store holds, and
    // `JSON.stringify` would turn the overflow back into null before it got here.
    expect(parseLayout('{"version":1,"zoom":1e999}').zoom).toBeNull();
  });

  it('clamps a preset into the zoom band the plan itself uses', () => {
    // Against the exported bounds, which the canvas wheel handler also clamps to:
    // a literal here would pass while the two drifted apart.
    expect(zoomScale(0.0001)).toBe(ZOOM_MIN_SCALE);
    expect(zoomScale(1_000_000)).toBe(ZOOM_MAX_SCALE);
    expect(ZOOM_MIN_SCALE).toBeLessThan(ZOOM_REFERENCE_SCALE);
    expect(ZOOM_MAX_SCALE).toBeGreaterThan(ZOOM_REFERENCE_SCALE);
  });

  it('multiplies the drawn grid step up until the lines are readable', () => {
    expect(gridStepAt(4)).toBe(GRID_YARDS);
    // Zoomed out, a 10 yard grid is a grey wash: the step steps up instead.
    expect(gridStepAt(0.4)).toBeGreaterThan(GRID_YARDS);
    expect(gridStepAt(0.4) * 0.4).toBeGreaterThanOrEqual(12);
  });

  it('refuses a grid it cannot draw, rather than looping on infinities', () => {
    // The freeze this pins, and it really did lock the browser at 100% CPU on the
    // first frame: the plan measures zero until the first animation frame, a view
    // fitted against that has a scale of zero, and a zero scale makes the visible
    // span infinite. `for (let x = -Infinity; x <= Infinity; x += step)` never
    // advances.
    expect(gridRange(0, 1200, 0, 10)).toBeNull();
    expect(gridRange(0, 0, 2.4, 10)).toBeNull();
    expect(gridRange(0, 1200, -1, 10)).toBeNull();
    expect(gridRange(0, 1200, 2.4, 0)).toBeNull();
    expect(gridRange(0, Number.POSITIVE_INFINITY, 2.4, 10)).toBeNull();
    expect(gridRange(Number.NaN, 1200, 2.4, 10)).toBeNull();
  });

  it('walks a drawable grid from the first line to the last, and terminates', () => {
    const range = gridRange(0, 1200, 2.4, 10);
    expect(range).not.toBeNull();
    if (!range) return;
    // 1200 px at 2.4 px/yd is 500 yards across, so 50 lines at a 10 yard step.
    let lines = 0;
    for (let x = range.first; x <= range.last; x += 10) lines++;
    expect(lines).toBeGreaterThan(40);
    expect(lines).toBeLessThan(60);
    expect(range.first % 10).toBeCloseTo(0, 10);
  });

  it('refuses a span that would draw more lines than a grid can be read at', () => {
    // Past the cap the grid is a solid wash, and something upstream is wrong.
    expect(gridRange(0, 100_000, 20, 1)).toBeNull();
    expect(MAX_GRID_LINES).toBeGreaterThan(50);
  });

  it('hands back a usable step at a scale no grid can be drawn at', () => {
    // It used to run its loop to the ceiling and return 10 000.
    expect(gridStepAt(0)).toBe(GRID_YARDS);
    expect(gridStepAt(-2)).toBe(GRID_YARDS);
  });

  it('rounds an authored coordinate only when snapping is on', () => {
    expect(snapValue(13.4, false)).toBe(13.4);
    expect(snapValue(13.4, true)).toBe(10);
    expect(snapValue(-16, true)).toBe(-20);
    expect(snapPoint({ x: 4, z: -4 }, true)).toEqual({ x: 0, z: -0 });
    expect(snapPoint({ x: 4.2, z: -4.2 }, false)).toEqual({ x: 4.2, z: -4.2 });
  });
});

describe('the headline chips', () => {
  const metrics = realmRacersCircuitMetrics(REALM_RACERS_PRACTICE_CIRCUIT);

  it('reads the three numbers off the real readout', () => {
    const chips = headlineChips(metrics);
    expect(chips.map((chip) => chip.id)).toEqual(['lap', 'tightest', 'props']);
    expect(chips[0].value).toBe(metrics.lapLength.toFixed(1));
    // The one value that was never asserted, which is the one the tone is about.
    expect(chips[1].value).toBe(metrics.minRadiusOverWidth.toFixed(2));
    expect(chips[2].value).toBe(String(metrics.propCount));
    expect(chips.map((chip) => chip.unit)).toEqual(['yd', 'r/w', '']);
  });

  it('says what each chip is counting in its own title', () => {
    // Every title was unasserted, so a chip could have carried another chip's
    // explanation, which is the one thing a hover is for.
    const chips = headlineChips(metrics);
    const title = (id: string): string => chips.find((chip) => chip.id === id)?.title ?? '';
    expect(title('lap')).toBe(`${metrics.sampleCount} samples around the lap`);
    // The whole sentence, like the other two: `toContain('1')` for the floor was
    // satisfied by the 1.5 beside it and by almost any title, so the two
    // thresholds could swap places unnoticed.
    expect(title('tightest')).toBe(
      `corner radius over road half-width, at ${metrics.minRadiusOverWidthAtS.toFixed(0)} yd; under ${REALM_RACERS_RADIUS_OVER_WIDTH_WARN} is tight, under ${REALM_RACERS_RADIUS_OVER_WIDTH_FLOOR} folds the road`,
    );
    expect(title('props')).toBe(
      `${metrics.propCount} placed, ${metrics.scatterCount} scattered, ${metrics.pondCount} pond(s)`,
    );
  });

  it('tints the corner ratio against the SIM own thresholds, not a copy of them', () => {
    // The readout emits `corner_near_road_width` at exactly these two numbers;
    // re-typing them here would let the chip tint a corner green that the readout
    // is already complaining about.
    const tone = (ratio: number): string =>
      headlineChips({ ...metrics, minRadiusOverWidth: ratio }).find(
        (chip) => chip.id === 'tightest',
      )?.tone ?? '';
    expect(tone(REALM_RACERS_RADIUS_OVER_WIDTH_FLOOR - 0.01)).toBe('bad');
    expect(tone(REALM_RACERS_RADIUS_OVER_WIDTH_FLOOR)).toBe('warn');
    expect(tone(REALM_RACERS_RADIUS_OVER_WIDTH_WARN - 0.01)).toBe('warn');
    expect(tone(REALM_RACERS_RADIUS_OVER_WIDTH_WARN)).toBe('good');
  });

  it('tints the corner ratio against the 1.5 floor and the 1.0 fold', () => {
    const tone = (ratio: number): string =>
      headlineChips({ ...metrics, minRadiusOverWidth: ratio }).find(
        (chip) => chip.id === 'tightest',
      )?.tone ?? '';
    expect(tone(0.9)).toBe('bad');
    expect(tone(1.2)).toBe('warn');
    expect(tone(1.49)).toBe('warn');
    expect(tone(1.5)).toBe('good');
    expect(tone(3)).toBe('good');
  });
});

describe('problems on the plan', () => {
  it('names the worst one in the chip rather than only counting', () => {
    expect(problemsChip([])).toEqual({ text: 'no problems', tone: 'clean', focus: null });
    const warned = problemsChip([problem({ severity: 'warning', code: 'corner_near_road_width' })]);
    expect(warned.tone).toBe('warn');
    expect(warned.text).toBe(`1 problem - ${PROBLEM_LABELS.corner_near_road_width}`);
    // An error outranks a warning that came first in the list.
    const mixed = problemsChip([
      problem({ severity: 'warning', code: 'corner_near_road_width' }),
      problem({ severity: 'error', code: 'self_crossing' }),
    ]);
    expect(mixed.tone).toBe('bad');
    expect(mixed.text).toBe(`2 problems - ${PROBLEM_LABELS.self_crossing}`);
  });

  it('names the SAME problem in its text and its focus target', () => {
    // The shell used to re-derive `find(error) ?? [0]` to decide what a click
    // focuses, so a change to the tie-break here would have made the chip's text
    // and its target disagree.
    const located = problem({ severity: 'error', code: 'corner_folds_road', s: 210 });
    const chip = problemsChip([problem({ severity: 'warning', s: 10 }), located]);
    expect(chip.focus).toBe(located);
    expect(chip.text).toContain(PROBLEM_LABELS.corner_folds_road);
    // A whole-loop fault has nowhere to focus, so the chip offers no target.
    expect(problemsChip([problem({ code: 'reversed_winding', s: -1 })]).focus).toBeNull();
  });

  it('calls out the LOCATED problems only, errors first, capped', () => {
    const problems = [
      problem({ severity: 'warning', s: 10 }),
      problem({ severity: 'error', code: 'reversed_winding', s: -1 }),
      problem({ severity: 'error', s: 20 }),
      problem({ severity: 'error', s: 30 }),
    ];
    const callouts = calloutProblems(problems);
    // The whole-loop fault has no point to pin to, so it is not a callout.
    expect(callouts).toHaveLength(3);
    expect(callouts.map((p) => p.s)).toEqual([20, 30, 10]);
    expect(calloutProblems(problems, 1).map((p) => p.s)).toEqual([20]);
    expect(calloutProblems(problems, 0)).toHaveLength(0);
    expect(MAX_CANVAS_CALLOUTS).toBeGreaterThan(0);
  });

  it('nudges two callouts on the same pixel apart, keeping the worst-first order', () => {
    // The defect: two corners of a chicane project a few pixels apart, and the
    // second box lands on top of the first, so neither reads.
    const spread = spreadCallouts([
      { x: 100, y: 200 },
      { x: 140, y: 205 },
      { x: 180, y: 600 },
    ]);
    expect(spread[0]).toEqual({ x: 100, y: 200, flip: false });
    // Pushed DOWN to clear the first, and its x is untouched: the canvas marker
    // still rings the true spot.
    expect(spread[1]?.x).toBe(140);
    expect((spread[1]?.y ?? 0) - 200).toBeGreaterThanOrEqual(CALLOUT_MIN_GAP);
    // Far enough apart already: left where it was.
    expect(spread[2]).toEqual({ x: 180, y: 600, flip: false });
  });

  it('takes a gap of its own, and never writes on the anchors it was handed', () => {
    const anchors = [
      { x: 0, y: 0 },
      { x: 0, y: 1 },
    ];
    const spread = spreadCallouts(anchors, { gap: 120 });
    expect((spread[1]?.y ?? 0) - (spread[0]?.y ?? 0)).toBe(120);
    // The caller's list is the canvas markers' own list: nudging a box must not
    // move the ring it points at.
    expect(anchors).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 1 },
    ]);
  });

  it('opens a callout the OTHER way when its box would run off the plan', () => {
    // The defect: boxes only ever opened rightward, so a problem near the plan's
    // right edge wrote its explanation off the screen, which is the one case
    // where a callout says nothing at all.
    const width = 1000;
    const spread = spreadCallouts(
      [
        { x: 100, y: 10 },
        { x: width - 20, y: 400 },
      ],
      {
        planWidth: width,
      },
    );
    expect(spread[0]?.flip).toBe(false);
    expect(spread[1]?.flip).toBe(true);
    // Exactly at the reach it still fits; one pixel past it does not.
    expect(
      spreadCallouts([{ x: width - CALLOUT_REACH, y: 0 }], { planWidth: width })[0]?.flip,
    ).toBe(false);
    expect(
      spreadCallouts([{ x: width - CALLOUT_REACH + 1, y: 0 }], { planWidth: width })[0]?.flip,
    ).toBe(true);
    // No plan width (nothing measured yet) is nothing to run off.
    expect(spreadCallouts([{ x: 99999, y: 0 }])[0]?.flip).toBe(false);
    // The reach is a LITERAL here, not `width - CALLOUT_REACH` alone: the
    // boundary cases above compute both sides from the same constant, so it
    // could be 27 or 2740 and every one of them would still hold while every
    // callout flipped, or none did. It is the sheet's own geometry (a 14px
    // translate plus a 30ch box), which `editor_circuit_page.test.ts` pins from
    // the other side.
    expect(CALLOUT_REACH).toBe(274);
  });

  it('does not flip on a plan too narrow for the box either way', () => {
    // The mirror of the defect the flip was added for: `x + reach > width` alone
    // flips an anchor at x = 0 on a narrow plan, and the box then runs off the
    // LEFT instead. Flipping has to actually help.
    const narrow = 300;
    expect(spreadCallouts([{ x: 0, y: 0 }], { planWidth: narrow })[0]?.flip).toBe(false);
    expect(spreadCallouts([{ x: 200, y: 0 }], { planWidth: narrow })[0]?.flip).toBe(false);
    // Room on the left is what licenses it.
    expect(
      spreadCallouts([{ x: CALLOUT_REACH, y: 0 }], { planWidth: CALLOUT_REACH + 1 })[0]?.flip,
    ).toBe(true);
  });

  it('resolves the collisions top down, whatever order the callouts arrive in', () => {
    const spread = spreadCallouts([
      { x: 0, y: 300 },
      { x: 0, y: 290 },
      { x: 0, y: 295 },
    ]);
    const ys = spread.map((anchor) => anchor?.y ?? 0);
    // The topmost keeps its place; the other two stack under it in y order.
    expect(Math.min(...ys)).toBe(290);
    const sorted = [...ys].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i] - sorted[i - 1]).toBeGreaterThanOrEqual(CALLOUT_MIN_GAP);
    }
  });

  it('passes an off-plan callout straight through as null', () => {
    expect(spreadCallouts([null, { x: 5, y: 5 }, null])).toEqual([
      null,
      { x: 5, y: 5, flip: false },
      null,
    ]);
  });

  it('says where and against what, in one line each', () => {
    expect(problemHeadline(problem({ code: 'region_outside_band', axis: 'x' }))).toBe(
      `${PROBLEM_LABELS.region_outside_band} (x)`,
    );
    expect(problemDetail(problem({ value: 0.8, limit: 1, s: 120 }))).toBe(
      '0.80 against 1.00 at 120 yd',
    );
    expect(problemDetail(problem({ s: -1 }))).not.toContain(' at ');
  });

  it('labels every problem code the readout can emit', () => {
    // The readout is in `src/sim`, which is language-agnostic and emits codes;
    // an unlabelled code renders as `undefined` on the plan.
    for (const [code, label] of Object.entries(PROBLEM_LABELS)) {
      expect(label.length, code).toBeGreaterThan(0);
    }
    // Against LITERALS, not against itself: every assertion above and every use
    // elsewhere in this file quotes the table back at the table, so a label
    // rewritten into nonsense stayed green. The WHOLE table rather than a
    // handful of it, because three quarters pinned only to themselves is the
    // same defect in a smaller box.
    expect(PROBLEM_LABELS).toEqual({
      self_crossing: 'the loop crosses itself',
      reversed_winding: 'the loop runs clockwise',
      corner_folds_road: 'a corner is tighter than its own road',
      corner_near_road_width: 'a corner is close to its own road width',
      stretches_too_close: 'two stretches run close enough to break the projection',
      road_outside_perimeter: 'the road runs outside the perimeter wall',
      perimeter_outside_region: 'the perimeter wall is outside the collision region',
      region_outside_band: 'the region is wider than the instance band',
      region_deeper_than_lane_budget: 'the region is deeper than the gap between two lanes',
      pond_requires_basin: 'a pond on a circuit with no water authored',
      unknown_theme: 'the theme is not one the game authors',
      unknown_prop_asset: 'a prop names a catalog key nothing draws',
      prop_blocks_racing_surface: 'a prop stands on the racing surface',
      prop_outside_region: 'a prop stands outside the collision region',
      prop_in_camera_reach: 'a tall prop stands inside the chase camera reach',
      unknown_barrier_kit: 'a fence names a barrier kit nothing draws',
      fence_blocks_racing_surface: 'a fence crosses the racing surface',
      fence_outside_region: 'a fence leaves the collision region',
      pond_on_racing_surface: 'a pond reaches onto the racing surface',
      road_outside_ground_outline: 'the road runs off the ground you drew',
      ground_outline_folds: 'the ground you drew crosses itself',
      ground_outside_region: 'the ground you drew leaves the flat floor',
      pickup_row_off_road: 'a pickup row does not fit on the road there',
      pickup_row_lanes_overlap: 'a pickup row is narrow enough that its boxes overlap',
    });
    // Distinct, or two different faults read as the same one on the plan.
    const labels = Object.values(PROBLEM_LABELS);
    expect(new Set(labels).size).toBe(labels.length);
  });
});
