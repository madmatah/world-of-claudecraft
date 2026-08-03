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
  actionForShortcut,
  actionTooltip,
  autoSideTab,
  CALLOUT_MIN_GAP,
  calloutProblems,
  cheatBlocks,
  chordHints,
  clampDock,
  DEFAULT_LAYOUT,
  DOCK_MIN_HEIGHT,
  DOCK_MIN_WIDTH,
  defaultDock,
  EDITOR_ACTIONS,
  editorAction,
  formatShortcut,
  GRID_YARDS,
  gridStepAt,
  headlineChips,
  LAYOUT_STORAGE_KEY,
  MAX_CANVAS_CALLOUTS,
  MENU_ITEMS,
  MENUS,
  MODE_ACTIONS,
  menuActions,
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
  type RealmRacersCircuitProblem,
  realmRacersCircuitMetrics,
} from '../src/sim/realm_racers_circuit_metrics';

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
    expect(digits).toEqual(['1', '2', '3', '4']);
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

  it('prints the status-bar hints as chord plus verb', () => {
    const hints = chordHints('other');
    expect(hints).toContain('ctrl+Z undo');
    expect(hints).toContain('wheel zoom');
    expect(hints).toContain('middle-drag pan');
    expect(hints).toContain('shift+R flip direction');
    expect(chordHints('mac')).toContain('cmd+Z undo');
  });

  it('names both the action and the way to reach it in a tooltip', () => {
    const tooltip = actionTooltip(editorAction('undo'), 'other');
    expect(tooltip).toContain('Undo');
    expect(tooltip).toContain('ctrl+Z');
    // A pointer gesture prints its gesture, not an empty chord.
    expect(actionChord(editorAction('panView'), 'mac')).toBe('middle-drag');
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

  it('gives the two painting tools a value field, and the others none', () => {
    expect(TOOL_VALUE_FIELDS.width?.label).toContain('half-width');
    expect(TOOL_VALUE_FIELDS.props?.label).toContain('spacing');
    expect(TOOL_VALUE_FIELDS.draw).toBeNull();
    expect(TOOL_VALUE_FIELDS.handles).toBeNull();
    expect(TOOL_VALUE_FIELDS.race).toBeNull();
    // Different quantities, so different legal ranges: one field, re-bounded.
    expect(TOOL_VALUE_FIELDS.width?.max).not.toBe(TOOL_VALUE_FIELDS.props?.max);
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
    // All three tabs arm or edit a piece of DRESSING, so all three are dead in a
    // tool that places none. The regression this pins: shape and width kept the
    // outliner, which listed props at an operator painting a road.
    expect(sideTabsFor('props')).toEqual(['library', 'inspector', 'outliner']);
    expect(sideTabsFor('shape')).toEqual([]);
    expect(sideTabsFor('width')).toEqual([]);
    expect(sideTabsFor('race')).toEqual([]);
  });

  it('opens the panel on the library while placing and the inspector over a selection', () => {
    expect(autoSideTab('props', false)).toBe('library');
    expect(autoSideTab('props', true)).toBe('inspector');
    // Nothing to open in a mode with no tabs, selection or not: what shows there
    // is the mode readout, which is not a tab.
    expect(autoSideTab('shape', false)).toBeNull();
    expect(autoSideTab('shape', true)).toBeNull();
    expect(autoSideTab('width', true)).toBeNull();
    // RACE mode IS the form; a tab strip over it decides nothing.
    expect(autoSideTab('race', false)).toBeNull();
    expect(autoSideTab('race', true)).toBeNull();
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
      invertLook: true,
      grid: false,
      snap: true,
      zoom: 3.5,
      side: 'outliner' as const,
    };
    expect(parseLayout(serializeLayout(layout))).toEqual(layout);
  });

  it('drops a field of the wrong type back to its default instead of carrying it', () => {
    const parsed = parseLayout(
      JSON.stringify({ version: 1, grid: 'yes', zoom: -3, side: 'nope', dock: 7 }),
    );
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
    expect(chips[2].value).toBe(String(metrics.propCount));
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
    expect(problemsChip([])).toEqual({ text: 'no problems', tone: 'clean' });
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
    expect(spread[0]).toEqual({ x: 100, y: 200 });
    // Pushed DOWN to clear the first, and its x is untouched: the canvas marker
    // still rings the true spot.
    expect(spread[1]?.x).toBe(140);
    expect((spread[1]?.y ?? 0) - 200).toBeGreaterThanOrEqual(CALLOUT_MIN_GAP);
    // Far enough apart already: left where it was.
    expect(spread[2]).toEqual({ x: 180, y: 600 });
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
    expect(spreadCallouts([null, { x: 5, y: 5 }, null])).toEqual([null, { x: 5, y: 5 }, null]);
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
  });
});
