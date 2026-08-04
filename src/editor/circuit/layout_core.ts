// The circuit editor's SHELL: what the workbench remembers between sessions,
// and the one table every piece of chrome reads.
//
// Two responsibilities, and they are here together for one reason: the menu bar,
// the tool rail, the status-bar chord hints and the keyboard all have to name the
// same actions with the same shortcuts, and four copies of that list drift. The
// table is the source; every surface renders it.
//
// Pure and DOM-free, like every core in this directory: the page turns what these
// functions return into elements. Dev tool, so English lives here (no `t()`).

import type {
  RealmRacersCircuitMetrics,
  RealmRacersCircuitProblem,
  RealmRacersCircuitProblemCode,
} from '../../sim/realm_racers_circuit_metrics';
import {
  REALM_RACERS_RADIUS_OVER_WIDTH_FLOOR,
  REALM_RACERS_RADIUS_OVER_WIDTH_WARN,
} from '../../sim/realm_racers_circuit_metrics';
import { REALM_RACERS_MIN_HALF_WIDTH } from '../../sim/realm_racers_layout';
import type { EditorIconId } from './editor_icons';

// ---- the plan's own units ----

/** The reference zoom, px per yard: what the presets and the chip call 100%. */
export const ZOOM_REFERENCE_SCALE = 2.4;
export const ZOOM_MIN_SCALE = 0.4;
export const ZOOM_MAX_SCALE = 20;

/** The reference grid, and what a snapped gesture rounds to. */
export const GRID_YARDS = 10;

// ---- the tools ----

/** What the left rail offers. SHAPE is one intent over two gestures: a blank
 *  canvas is drawn on, a drawn one is edited by its handles, and which of the
 *  two the operator gets was never a choice worth a button of its own. */
export type RailModeId = 'shape' | 'width' | 'props' | 'race';

/** The gesture the canvas is actually routing, which SHAPE resolves into two. */
export type CircuitTool = 'draw' | 'handles' | 'width' | 'props' | 'race';

/**
 * How the next dressing gesture lays what is armed.
 *
 * Three because they are three different QUESTIONS, not three densities: a
 * single piece is placed, a scatter is sown over an area, and a row is laid
 * along the road. Only the last two have a spacing, and only the last one
 * follows a later centerline edit.
 *
 * It lives HERE, in the shell's own vocabulary, because the banner has to name
 * it and `placement_core.ts` already imports this module for the grid snap: one
 * union in the other direction would be a cycle, and two unions spelled the same
 * way is a fourth mode that compiles while the banner silently says "single".
 */
export type PlacementMode = 'single' | 'scatter' | 'alongRoad';

export interface RailModeDef {
  id: RailModeId;
  label: string;
  icon: EditorIconId;
  /** The digit that selects it, matching its position in the rail. */
  shortcut: string;
  detail: string;
}

export const RAIL_MODES: readonly RailModeDef[] = [
  {
    id: 'shape',
    label: 'Shape',
    icon: 'shape',
    shortcut: '1',
    detail: 'Draw the centerline, then move, insert and delete its handles',
  },
  {
    id: 'width',
    label: 'Width',
    icon: 'width',
    shortcut: '2',
    detail: 'Paint the road half-width along the lap',
  },
  {
    id: 'props',
    label: 'Props',
    icon: 'props',
    shortcut: '3',
    detail: 'Place the scenery: props, seeded scatters and decorative ponds',
  },
  {
    id: 'race',
    label: 'Race',
    icon: 'flag',
    shortcut: '4',
    detail: 'The race furniture on the road, plus the enclosure and the race settings',
  },
];

/**
 * The gesture the canvas routes.
 *
 * SHAPE is one intent over two gestures and resolves by STATE, not by a button:
 * a blank canvas is drawn on, a drawn one is edited by its handles. `redrawing`
 * is the third case, and it exists because merging the two lost a real authoring
 * move: the old tool let an operator re-stroke the centerline of a DRAWN circuit
 * and keep everything else on the record (the dressing, the width profile, the
 * id, the theme, the race settings), and the only way back to a stroke without it
 * is New blank, which discards the whole document.
 */
export function toolFor(mode: RailModeId, drawn: boolean, redrawing = false): CircuitTool {
  if (mode === 'shape') return drawn && !redrawing ? 'handles' : 'draw';
  return mode;
}

/**
 * The one line the canvas banner carries: what the active tool does.
 *
 * PROPS takes a fourth argument because it is no longer one gesture. The
 * library's placement block decides whether a drag places, sows or lays, and a
 * banner that went on describing all three at once would be the tool refusing to
 * say which one it is about to do.
 */
export function railBanner(
  mode: RailModeId,
  drawn: boolean,
  redrawing = false,
  placement: PlacementMode = 'single',
): string {
  switch (toolFor(mode, drawn, redrawing)) {
    case 'draw':
      return redrawing
        ? 'drag a new centerline: the dressing, the road profile and the race settings all stay as they are'
        : 'drag anywhere to draw the centerline in one gesture; the fitted curve replaces the stroke on release';
    case 'handles':
      return 'drag a handle to move it, click the curve to insert one, del to delete';
    case 'width':
      return 'drag along the circuit to set the road half-width there; the road is twice this wide';
    case 'props':
      return placement === 'scatter'
        ? 'drag a box to sow a seeded patch of the armed piece over that stretch of one side'
        : placement === 'alongRoad'
          ? 'drag ALONG the road to lay a row at the spacing, from the offset the drag started at'
          : 'drag a tile from the library, or click to place the armed piece; R turns it, alt places it free';
    case 'race':
      // RACE became a canvas tool the day the circuit had furniture worth
      // placing. Its forms are still the panel; what the plan offers is the one
      // gesture the numbers cannot express.
      return drawn
        ? 'click the road to lay a pickup row across it, click a row to select it, del removes it'
        : 'the numbers a circuit carries that nothing on the canvas can show';
    default:
      return 'the numbers a circuit carries that nothing on the canvas can show';
  }
}

/**
 * What the tool's one NUMBER means, and what it is allowed to be.
 *
 * It is not a brush SIZE, which is what "brush" says in every other tool: it is
 * the value the stroke paints, in yards, and the two painting tools paint two
 * different quantities with two different legal ranges.
 */
export interface ToolValueField {
  label: string;
  min: number;
  max: number;
}

/** The field's own range, applied to whatever the box currently holds. The shell
 *  was re-deriving this clamp beside the range the table already gives it. */
export function clampToolValue(field: ToolValueField, raw: number): number {
  if (!Number.isFinite(raw)) return field.min;
  return Math.min(field.max, Math.max(field.min, raw));
}

export const TOOL_VALUE_FIELDS: Record<CircuitTool, ToolValueField | null> = {
  draw: null,
  handles: null,
  width: { label: 'road half-width (yd)', min: REALM_RACERS_MIN_HALF_WIDTH, max: 40 },
  // PROPS has none any more. It used to carry the scatter's spacing, and the
  // library's own placement block now owns that number along with the mode and
  // the two toggles it only means anything beside: a spacing in the tool strip
  // and a spacing in the placement block would be two boxes holding one value.
  props: null,
  race: null,
};

// ---- the action table ----

export type ActionId =
  | 'newBlank'
  | 'load'
  | 'saveDraft'
  | 'copyRecord'
  | 'undo'
  | 'redo'
  | 'toggleDock'
  | 'dockFullscreen'
  | 'toggleMetrics'
  | 'toggleGrid'
  | 'toggleSnap'
  | 'fitView'
  | 'zoomOut'
  | 'zoomReset'
  | 'zoomIn'
  | 'redrawCenterline'
  | 'disarmTool'
  | 'fitEnclosure'
  | 'fixCorners'
  | 'raceSettings'
  | 'modeShape'
  | 'modeWidth'
  | 'modeProps'
  | 'modeRace'
  | 'keys'
  | 'deleteSelection'
  | 'duplicateSelection'
  | 'nudgeSelection'
  | 'focusSelection'
  | 'rotateProp'
  | 'faceRacing'
  | 'scaleUp'
  | 'scaleDown'
  | 'toggleCollide'
  | 'panView'
  | 'wheelZoom'
  | 'dockPlay'
  | 'orbitHere'
  | 'panDock'
  | 'lookDock';

export type MenuId = 'file' | 'edit' | 'view' | 'track';

/**
 * Where an action can fire from.
 *
 * `selection` actions only mean anything with a dressing piece selected, so the
 * page routes them itself inside the props branch; the generic dispatcher walks
 * the `global` ones. They are still in the table because the cheatsheet and the
 * status hints have to list them.
 */
export type ActionScope = 'global' | 'selection' | 'pointer';

export interface EditorActionDef {
  id: ActionId;
  label: string;
  detail: string;
  icon: EditorIconId;
  scope: ActionScope;
  /** Canonical chord, lowercase, `mod` for ctrl-or-cmd. Absent on pointer
   *  gestures, which carry `gesture` instead. */
  shortcut?: string;
  gesture?: string;
  menu?: MenuId;
  /** Whether it toggles something, so the menu can carry a checkmark. */
  toggle?: true;
  /** Whether it needs a circuit to act on, which is what a blank canvas refuses.
   *  On the ROW so the enable sweep and the dispatch guard read one source. */
  needsCircuit?: true;
  /** Short verb the status bar's chord hints use. A hint is deliberately not the
   *  label: "flip direction" reads better in a hint row than "Face the racing
   *  direction". */
  hint?: string;
  /** Which cheatsheet block it belongs to. */
  group: 'file' | 'edit' | 'view' | 'track' | 'tools' | 'selection' | 'canvas';
}

export const MENUS: readonly { id: MenuId; label: string }[] = [
  { id: 'file', label: 'File' },
  { id: 'edit', label: 'Edit' },
  { id: 'view', label: 'View' },
  { id: 'track', label: 'Track' },
];

export const EDITOR_ACTIONS: readonly EditorActionDef[] = [
  {
    id: 'newBlank',
    label: 'New blank',
    detail: 'Clear the canvas and draw a circuit from nothing',
    icon: 'file',
    scope: 'global',
    menu: 'file',
    group: 'file',
  },
  {
    id: 'load',
    label: 'Load',
    detail: 'Start from a shipped circuit, or from a starter oval',
    icon: 'folder',
    scope: 'global',
    shortcut: 'mod+o',
    menu: 'file',
    group: 'file',
  },
  {
    id: 'saveDraft',
    needsCircuit: true,
    label: 'Save draft',
    detail: 'Write the record to tmp/circuit-drafts, ready for /dev rallydraft',
    icon: 'save',
    scope: 'global',
    shortcut: 'mod+s',
    menu: 'file',
    group: 'file',
  },
  {
    id: 'copyRecord',
    needsCircuit: true,
    label: 'Copy record',
    detail: 'Copy the record as TypeScript, to paste into realm_racers_circuits.ts',
    icon: 'clipboard',
    scope: 'global',
    menu: 'file',
    group: 'file',
  },
  {
    id: 'undo',
    label: 'Undo',
    detail: 'Step back one edit',
    icon: 'undo',
    scope: 'global',
    shortcut: 'mod+z',
    menu: 'edit',
    hint: 'undo',
    group: 'edit',
  },
  {
    id: 'redo',
    label: 'Redo',
    detail: 'Step forward again',
    icon: 'redo',
    scope: 'global',
    shortcut: 'mod+shift+z',
    menu: 'edit',
    group: 'edit',
  },
  {
    id: 'toggleDock',
    needsCircuit: true,
    label: '3D dock',
    detail: "Show the circuit in 3D, through the game's own track builder",
    icon: 'cube',
    scope: 'global',
    shortcut: 'f3',
    menu: 'view',
    toggle: true,
    group: 'view',
  },
  {
    id: 'dockFullscreen',
    label: 'Dock fullscreen',
    detail: 'Blow the 3D dock up to the whole plan, and back',
    icon: 'fullscreen',
    scope: 'global',
    shortcut: 'shift+f',
    toggle: true,
    group: 'view',
  },
  {
    id: 'toggleMetrics',
    label: 'Metrics detail',
    detail: 'The whole readout, section by section',
    icon: 'gauge',
    scope: 'global',
    shortcut: 'm',
    menu: 'view',
    toggle: true,
    group: 'view',
  },
  {
    id: 'toggleGrid',
    label: 'Grid',
    detail: `A ${GRID_YARDS} yard reference grid under the circuit`,
    icon: 'grid',
    scope: 'global',
    shortcut: 'g',
    menu: 'view',
    toggle: true,
    group: 'view',
  },
  {
    id: 'toggleSnap',
    label: `Snap to the ${GRID_YARDS} yd grid`,
    detail: `Round every handle drag and every piece you place to the ${GRID_YARDS} yard grid, so a row of them lines up. Off means free placement`,
    icon: 'magnet',
    scope: 'global',
    shortcut: 's',
    menu: 'view',
    toggle: true,
    group: 'view',
  },
  {
    id: 'fitView',
    label: 'Fit view',
    detail: 'Frame the whole circuit',
    icon: 'frame',
    scope: 'global',
    shortcut: '0',
    menu: 'view',
    group: 'view',
  },
  {
    id: 'zoomOut',
    label: 'Zoom 50%',
    detail: 'Half the reference zoom',
    icon: 'zoomOut',
    scope: 'global',
    menu: 'view',
    group: 'view',
  },
  {
    id: 'zoomReset',
    label: 'Zoom 100%',
    detail: 'The reference zoom',
    icon: 'zoom',
    scope: 'global',
    menu: 'view',
    group: 'view',
  },
  {
    id: 'zoomIn',
    label: 'Zoom 200%',
    detail: 'Twice the reference zoom',
    icon: 'zoomIn',
    scope: 'global',
    menu: 'view',
    group: 'view',
  },
  {
    id: 'redrawCenterline',
    needsCircuit: true,
    label: 'Redraw centerline',
    detail:
      'Draw a new centerline over this circuit, keeping its dressing, its road profile and its race settings. New blank discards those; this does not',
    icon: 'shape',
    scope: 'global',
    menu: 'track',
    group: 'track',
  },
  {
    id: 'disarmTool',
    label: 'Pointer, and drop the selection',
    detail: 'Put the props tool back to the pointer, so a click on empty plan places nothing',
    icon: 'close',
    scope: 'global',
    shortcut: 'escape',
    group: 'selection',
  },
  {
    id: 'fitEnclosure',
    needsCircuit: true,
    label: 'Fit enclosure',
    detail: 'Size the perimeter wall and the collision region to the road',
    icon: 'box',
    scope: 'global',
    menu: 'track',
    group: 'track',
  },
  {
    id: 'fixCorners',
    needsCircuit: true,
    label: 'Fix corners',
    detail: 'Narrow the road wherever a corner is tighter than it',
    icon: 'wrench',
    scope: 'global',
    menu: 'track',
    group: 'track',
  },
  {
    id: 'raceSettings',
    needsCircuit: true,
    label: 'Race settings',
    detail: 'The enclosure and the race numbers, in the right panel',
    icon: 'flag',
    scope: 'global',
    menu: 'track',
    group: 'track',
  },
  {
    id: 'modeShape',
    label: 'Shape',
    detail: 'Draw the centerline, then edit its handles',
    icon: 'shape',
    scope: 'global',
    shortcut: '1',
    group: 'tools',
  },
  {
    id: 'modeWidth',
    needsCircuit: true,
    label: 'Width',
    detail: 'Paint the road half-width along the lap',
    icon: 'width',
    scope: 'global',
    shortcut: '2',
    group: 'tools',
  },
  {
    id: 'modeProps',
    needsCircuit: true,
    label: 'Props',
    detail: 'Place props, scatters and ponds',
    icon: 'props',
    scope: 'global',
    shortcut: '3',
    group: 'tools',
  },
  {
    id: 'modeRace',
    needsCircuit: true,
    label: 'Race',
    detail: 'Lay the pickup rows, and edit the enclosure and the race settings',
    icon: 'flag',
    scope: 'global',
    shortcut: '4',
    group: 'tools',
  },
  {
    id: 'keys',
    label: 'Keys',
    detail: 'Every shortcut this tool has',
    icon: 'keyboard',
    scope: 'global',
    shortcut: '?',
    menu: 'view',
    group: 'view',
  },
  {
    id: 'deleteSelection',
    label: 'Delete',
    detail: 'Delete the selected handle or dressing piece',
    icon: 'trash',
    scope: 'selection',
    shortcut: 'delete',
    group: 'selection',
  },
  {
    id: 'duplicateSelection',
    label: 'Duplicate',
    detail: 'Put a second copy of the selected piece beside it, and select the copy',
    icon: 'duplicate',
    scope: 'selection',
    shortcut: 'mod+d',
    group: 'selection',
  },
  {
    id: 'nudgeSelection',
    label: 'Nudge',
    // A GESTURE rather than a chord, and deliberately: four arrow rows plus four
    // shifted ones is a cheatsheet block nobody reads to the end, and the page
    // matches the keys off `nudgeKeyOf` instead. What the table owns here is the
    // one line an operator has to be told.
    detail: 'Move the selected piece a step, or a bigger step with shift held',
    icon: 'move',
    scope: 'selection',
    gesture: 'arrows (shift: bigger)',
    group: 'selection',
  },
  {
    id: 'focusSelection',
    label: 'Focus the selection',
    detail: 'Centre the plan on the selected piece, and the 3D dock with it',
    icon: 'target',
    scope: 'selection',
    shortcut: 'f',
    group: 'selection',
  },
  {
    id: 'rotateProp',
    label: 'Rotate',
    detail: 'Turn the selected piece a step',
    icon: 'rotate',
    scope: 'selection',
    shortcut: 'r',
    hint: 'rotate',
    group: 'selection',
  },
  {
    id: 'faceRacing',
    label: 'Face the racing direction',
    detail: 'Re-read the tangent wherever the piece is moved to',
    icon: 'tangent',
    scope: 'selection',
    shortcut: 'shift+r',
    hint: 'flip direction',
    group: 'selection',
  },
  {
    id: 'scaleUp',
    label: 'Scale up',
    detail: 'Grow the selected piece a step',
    icon: 'plus',
    scope: 'selection',
    shortcut: '+',
    group: 'selection',
  },
  {
    id: 'scaleDown',
    label: 'Scale down',
    detail: 'Shrink the selected piece a step',
    icon: 'minus',
    scope: 'selection',
    shortcut: '-',
    group: 'selection',
  },
  {
    id: 'toggleCollide',
    label: 'Toggle collision',
    detail: 'Whether the selected piece stops a machine',
    icon: 'collide',
    scope: 'selection',
    shortcut: 'c',
    group: 'selection',
  },
  {
    id: 'panView',
    label: 'Pan',
    detail: 'Slide the plan under the pointer',
    icon: 'move',
    scope: 'pointer',
    gesture: 'middle-drag',
    hint: 'pan',
    group: 'canvas',
  },
  {
    id: 'wheelZoom',
    label: 'Zoom',
    detail: 'Zoom about the pointer',
    icon: 'zoom',
    scope: 'pointer',
    gesture: 'wheel',
    hint: 'zoom',
    group: 'canvas',
  },
  {
    id: 'dockPlay',
    label: 'Play or pause the fly-through',
    detail:
      'Ride the lap, or stop where you are. Starting again puts the view back down the road, so a resumed lap always begins from the pilot own forward POV',
    icon: 'fly',
    scope: 'global',
    shortcut: 'space',
    group: 'view',
  },
  {
    id: 'orbitHere',
    label: 'Orbit this spot in 3D',
    detail: 'Put the 3D dock camera on that point of the plan',
    icon: 'orbit',
    scope: 'pointer',
    gesture: 'double-click',
    group: 'canvas',
  },
  {
    id: 'panDock',
    label: 'Pan the 3D camera',
    detail: 'Slide the orbit target across the ground, in the dock',
    icon: 'move',
    scope: 'pointer',
    gesture: 'shift-drag in 3D',
    group: 'canvas',
  },
  {
    id: 'lookDock',
    label: 'Look around from the seat',
    detail: 'Turn the pilot head in the fly-through, without moving the eye',
    icon: 'fly',
    scope: 'pointer',
    gesture: 'drag in 3D',
    group: 'canvas',
  },
];

const ACTION_BY_ID = new Map(EDITOR_ACTIONS.map((action) => [action.id, action]));

export function editorAction(id: ActionId): EditorActionDef {
  const action = ACTION_BY_ID.get(id);
  // Unreachable through the table above; a throw beats a silent undefined if a
  // later session adds a menu entry and forgets its row.
  if (!action) throw new Error(`no such editor action: ${id}`);
  return action;
}

/**
 * What each menu lists, in order.
 *
 * Explicit rather than a filter over the table: the ORDER inside a menu is a
 * design choice (the four file actions read as a lifecycle, the zoom presets sit
 * under the view they change), and a filter would hand it to whatever order the
 * table happens to be written in.
 */
export const MENU_ITEMS: Record<MenuId, readonly ActionId[]> = {
  file: ['newBlank', 'load', 'saveDraft', 'copyRecord'],
  edit: ['undo', 'redo'],
  view: [
    'toggleDock',
    'toggleMetrics',
    'toggleGrid',
    'toggleSnap',
    'fitView',
    'zoomOut',
    'zoomReset',
    'zoomIn',
    'keys',
  ],
  track: ['redrawCenterline', 'fitEnclosure', 'fixCorners', 'raceSettings'],
};

export function menuActions(menu: MenuId): EditorActionDef[] {
  return MENU_ITEMS[menu].map(editorAction);
}

/** Which rail mode an action selects, for the four that do. */
export const MODE_ACTIONS: Record<RailModeId, ActionId> = {
  shape: 'modeShape',
  width: 'modeWidth',
  props: 'modeProps',
  race: 'modeRace',
};

/**
 * The repairs a mode puts ON the plan, beside its banner.
 *
 * They are in the Track menu too, and the menu is where they were LOST: fitting
 * the enclosure and narrowing a folded corner are both things an operator wants
 * the moment they finish a stroke, and hunting a menu bar for them broke the
 * gesture. A tool that has a repair shows it where the work is.
 *
 * `fixCorners` belongs to both shaping tools because it is both their business:
 * it narrows the ROAD (width's table) to clear a corner the CURVE made (shape's
 * geometry), and whichever of the two the operator is in is where they meet it.
 */
export function railActions(mode: RailModeId): readonly ActionId[] {
  switch (mode) {
    case 'shape':
      return ['redrawCenterline', 'fitEnclosure', 'fixCorners'];
    case 'width':
      return ['fixCorners'];
    case 'race':
      return ['fitEnclosure'];
    default:
      return [];
  }
}

/** Every action any mode puts on the plan, so the chrome can build each button
 *  once and only ever show or hide it. */
export const RAIL_ACTION_IDS: readonly ActionId[] = [
  ...new Set(RAIL_MODES.flatMap((mode) => railActions(mode.id))),
];

// ---- shortcuts ----

export type ShortcutPlatform = 'mac' | 'other';

export interface ShortcutEvent {
  key: string;
  /** The PHYSICAL key, which is how a digit shortcut is matched: see below. */
  code?: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}

/** The key half of a chord, as the DOM reports it, canonicalized. */
function eventKey(ev: ShortcutEvent): string {
  const key = ev.key.toLowerCase();
  if (key === 'backspace') return 'delete';
  if (key === '=') return '+';
  // The space bar reports a literal space, which cannot be written in a chord
  // spec: `mod+ +z` is not parseable and `space` is what the cheatsheet prints.
  if (key === ' ') return 'space';
  return key;
}

/**
 * Whether a chord spec matches a keystroke.
 *
 * Shift is compared exactly, EXCEPT where the modifier carries no intent because
 * the key only exists shifted. Two families, and both arrived from a real
 * keyboard rather than from theory:
 *
 * - Punctuation IS the shift of something on most layouts (`?` is shift+`/`,
 *   `+` is shift+`=`), so requiring `shiftKey` to be false would mean `?` could
 *   never fire at all.
 * - A DIGIT is shifted on AZERTY: pressing the `1` key there reports `&`, and
 *   `1` only arrives with shift held. So a digit shortcut matches on the
 *   PHYSICAL key (`code`, `Digit1`) as well, with shift ignored on that arm. The
 *   rail's `1..4` were dead on a French keyboard until this existed.
 */
export function shortcutMatches(spec: string, ev: ShortcutEvent): boolean {
  const parts = spec.toLowerCase().split('+');
  // `+` is both a separator and a key, so an empty tail is the plus key itself.
  const key = parts[parts.length - 1] === '' ? '+' : parts[parts.length - 1];
  const mods = new Set(parts.slice(0, key === '+' ? parts.length - 2 : parts.length - 1));
  const mod = Boolean(ev.ctrlKey || ev.metaKey);
  if (mods.has('mod') !== mod) return false;
  if (ev.altKey) return false;
  const digit = key.length === 1 && /[0-9]/.test(key);
  if (digit && ev.code === `Digit${key}`) return true;
  const shifted = key.length === 1 && !/[a-z]/.test(key);
  if (!shifted && mods.has('shift') !== Boolean(ev.shiftKey)) return false;
  return eventKey(ev) === key;
}

/**
 * The action a keystroke fires, or null.
 *
 * Only `global` rows: a selection action means nothing without a selection, and
 * the props branch already knows whether it has one.
 */
export function actionForShortcut(ev: ShortcutEvent): ActionId | null {
  return matchScope(ev, 'global');
}

/**
 * The action a keystroke fires ON THE SELECTION, or null.
 *
 * A second resolver rather than one, because the two are dispatched at different
 * times: a global chord fires whatever the tool, and a selection chord only means
 * something with a piece armed, which is a condition only the page knows. What
 * matters is that BOTH read the table: the selection chords used to be matched
 * against `ev.key` literals in the page, which is a fifth hand-kept copy of the
 * one list the table exists to replace.
 */
export function actionForSelectionShortcut(ev: ShortcutEvent): ActionId | null {
  return matchScope(ev, 'selection');
}

function matchScope(ev: ShortcutEvent, scope: ActionScope): ActionId | null {
  for (const action of EDITOR_ACTIONS) {
    if (action.scope !== scope || !action.shortcut) continue;
    if (shortcutMatches(action.shortcut, ev)) return action.id;
  }
  return null;
}

const KEY_LABELS: Record<string, string> = {
  space: 'space',
  delete: 'del',
  escape: 'esc',
  f3: 'F3',
};

/** A chord as the operator's own platform writes it. */
export function formatShortcut(spec: string, platform: ShortcutPlatform): string {
  const parts = spec.split('+');
  const key = parts[parts.length - 1] === '' ? '+' : parts[parts.length - 1];
  const mods = parts.slice(0, key === '+' ? parts.length - 2 : parts.length - 1);
  const out = mods.map((mod) => (mod === 'mod' ? (platform === 'mac' ? 'cmd' : 'ctrl') : mod));
  out.push(KEY_LABELS[key] ?? (key.length === 1 ? key.toUpperCase() : key));
  return out.join('+');
}

/** How an action is invoked, chord or gesture, ready to print. */
export function actionChord(action: EditorActionDef, platform: ShortcutPlatform): string {
  if (action.gesture) return action.gesture;
  return action.shortcut ? formatShortcut(action.shortcut, platform) : '';
}

/** The tooltip every icon button carries: what it does, and how to reach it. */
export function actionTooltip(action: EditorActionDef, platform: ShortcutPlatform): string {
  const chord = actionChord(action, platform);
  return chord
    ? `${action.label} (${chord}): ${action.detail}`
    : `${action.label}: ${action.detail}`;
}

/** The status bar's right end: the handful of chords worth having on screen. */
export function chordHints(platform: ShortcutPlatform): string[] {
  return EDITOR_ACTIONS.filter((action) => action.hint).map(
    (action) => `${actionChord(action, platform)} ${action.hint}`,
  );
}

/** The cheatsheet, grouped, off the same table. */
export interface CheatBlock {
  group: EditorActionDef['group'];
  label: string;
  rows: { chord: string; label: string }[];
}

const GROUP_LABELS: Record<EditorActionDef['group'], string> = {
  file: 'File',
  edit: 'Edit',
  view: 'View',
  track: 'Track',
  tools: 'Tools',
  selection: 'Selection',
  canvas: 'Canvas',
};

export function cheatBlocks(platform: ShortcutPlatform): CheatBlock[] {
  const order: EditorActionDef['group'][] = [
    'tools',
    'selection',
    'canvas',
    'file',
    'edit',
    'view',
    'track',
  ];
  return order
    .map((group) => ({
      group,
      label: GROUP_LABELS[group],
      rows: EDITOR_ACTIONS.filter(
        (action) => action.group === group && (action.shortcut || action.gesture),
      ).map((action) => ({ chord: actionChord(action, platform), label: action.label })),
    }))
    .filter((block) => block.rows.length > 0);
}

// ---- the persisted layout ----

export const LAYOUT_STORAGE_KEY = 'woc_circuit_editor_layout_v1';
const LAYOUT_VERSION = 1;

export interface DockGeometry {
  left: number;
  top: number;
  width: number;
  height: number;
}

export const DOCK_MIN_WIDTH = 240;
export const DOCK_MIN_HEIGHT = 160;
/** How far from the plan's bottom-right corner an unplaced dock opens. */
const DOCK_MARGIN = 14;

/** How many steps the fly-through scrubber divides a lap into. It is the range
 *  input's `max` AND the divisor its value is read back through, and those two
 *  disagreeing silently rescales the lap, so both come from here. */
export const DOCK_SCRUB_STEPS = 1000;

/** What the menu-bar dot says about the 3D preview. Here rather than in the
 *  shell because a state's NAME and its sentence are one fact. */
export type PreviewReadyState = 'off' | 'ready' | 'error';

export const PREVIEW_READY_TITLES: Record<PreviewReadyState, string> = {
  ready: 'the 3D preview is live on this record',
  error: 'the 3D preview could not start',
  off: 'the 3D preview is not open',
};

export type SideTabId = 'library' | 'inspector' | 'outliner';

/** Below this the tab strip is not drawn at all: a single tab is a click that
 *  decides nothing, and the panel's own heading already says what is in it. */
export const SIDE_TABS_MIN = 2;

export interface EditorLayout {
  /** Null until the operator has moved it: an unplaced dock opens bottom-right,
   *  which needs a viewport nobody has at parse time. */
  dock: DockGeometry | null;
  dockOpen: boolean;
  dockFullscreen: boolean;
  followCursor: boolean;
  /** Whether a downward drag in the fly-through tips the view UP. */
  invertLook: boolean;
  metricsOpen: boolean;
  grid: boolean;
  snap: boolean;
  /** Plan zoom, px per yard, or null to frame the circuit on boot. */
  zoom: number | null;
  side: SideTabId;
}

export const DEFAULT_LAYOUT: EditorLayout = {
  dock: null,
  dockOpen: false,
  dockFullscreen: false,
  followCursor: false,
  invertLook: false,
  metricsOpen: false,
  grid: true,
  snap: false,
  zoom: null,
  side: 'library',
};

const SIDE_TABS: readonly SideTabId[] = ['library', 'inspector', 'outliner'];

const finite = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const flag = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback;

/**
 * The stored layout, or the default.
 *
 * Versioned parse-or-default rather than a migration: this holds where a panel
 * sits, so a shape nobody recognizes is worth exactly nothing and a corrupt
 * store must never be able to break the page open.
 */
export function parseLayout(raw: string | null): EditorLayout {
  if (!raw) return { ...DEFAULT_LAYOUT };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_LAYOUT };
  }
  if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_LAYOUT };
  const held = parsed as Record<string, unknown>;
  if (held.version !== LAYOUT_VERSION) return { ...DEFAULT_LAYOUT };
  const dock = held.dock;
  const geometry =
    dock && typeof dock === 'object'
      ? (() => {
          const d = dock as Record<string, unknown>;
          return {
            left: finite(d.left, 0),
            top: finite(d.top, 0),
            width: finite(d.width, DOCK_MIN_WIDTH),
            height: finite(d.height, DOCK_MIN_HEIGHT),
          };
        })()
      : null;
  // Through `clampZoom`, not a bare `> 0` test: `JSON.parse('{"zoom":1e999}')`
  // yields Infinity, which passed the old guard and reached `view.scale`, where it
  // turns every screen coordinate into Infinity and opens the page blank. The
  // whole point of a versioned parse-or-default is that a corrupt store cannot do
  // that.
  const zoom = clampZoom(held.zoom);
  const side = SIDE_TABS.find((tab) => tab === held.side) ?? DEFAULT_LAYOUT.side;
  return {
    dock: geometry,
    dockOpen: flag(held.dockOpen, DEFAULT_LAYOUT.dockOpen),
    dockFullscreen: flag(held.dockFullscreen, DEFAULT_LAYOUT.dockFullscreen),
    followCursor: flag(held.followCursor, DEFAULT_LAYOUT.followCursor),
    invertLook: flag(held.invertLook, DEFAULT_LAYOUT.invertLook),
    metricsOpen: flag(held.metricsOpen, DEFAULT_LAYOUT.metricsOpen),
    grid: flag(held.grid, DEFAULT_LAYOUT.grid),
    snap: flag(held.snap, DEFAULT_LAYOUT.snap),
    zoom,
    side,
  };
}

export function serializeLayout(layout: EditorLayout): string {
  return JSON.stringify({ version: LAYOUT_VERSION, ...layout });
}

export interface PlanArea {
  width: number;
  height: number;
}

/** Where a dock nobody has placed opens: bottom-right, over the plan. */
export function defaultDock(area: PlanArea): DockGeometry {
  const width = Math.max(DOCK_MIN_WIDTH, Math.min(430, area.width - DOCK_MARGIN * 2));
  const height = Math.max(DOCK_MIN_HEIGHT, Math.min(300, area.height - DOCK_MARGIN * 2));
  return {
    left: Math.max(0, area.width - width - DOCK_MARGIN),
    top: Math.max(0, area.height - height - DOCK_MARGIN),
    width,
    height,
  };
}

/**
 * A dock geometry that is inside the plan and big enough to read.
 *
 * Clamped on every apply rather than only on the drag, because the window the
 * layout was stored from is not the window it is restored into: a dock parked
 * bottom-right on a wide monitor is off-screen entirely on a laptop, and a panel
 * nobody can reach is a panel nobody can close.
 */
export function clampDock(dock: DockGeometry, area: PlanArea): DockGeometry {
  const width = Math.min(
    Math.max(DOCK_MIN_WIDTH, dock.width),
    Math.max(DOCK_MIN_WIDTH, area.width),
  );
  const height = Math.min(
    Math.max(DOCK_MIN_HEIGHT, dock.height),
    Math.max(DOCK_MIN_HEIGHT, area.height),
  );
  return {
    left: Math.min(Math.max(0, dock.left), Math.max(0, area.width - width)),
    top: Math.min(Math.max(0, dock.top), Math.max(0, area.height - height)),
    width,
    height,
  };
}

// ---- the plan's own chrome ----

export const zoomPercent = (scale: number): number =>
  Math.round((scale / ZOOM_REFERENCE_SCALE) * 100);

export const zoomScale = (percent: number): number =>
  clampScale((percent / 100) * ZOOM_REFERENCE_SCALE);

/** The one clamp every zoom writer goes through: the presets, the wheel and the
 *  restore. Three hand-written copies of the same two bounds is how one of them
 *  ends up missing, which is exactly what happened to the restore. */
export const clampScale = (scale: number): number =>
  Math.min(ZOOM_MAX_SCALE, Math.max(ZOOM_MIN_SCALE, scale));

/** A stored zoom, or null. Anything not a finite number in the band is nothing:
 *  a plan cannot be drawn at Infinity and must not try. */
export function clampZoom(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return clampScale(value);
}

export function snapValue(value: number, enabled: boolean, step = GRID_YARDS): number {
  if (!enabled || step <= 0) return value;
  return Math.round(value / step) * step;
}

export function snapPoint<T extends { x: number; z: number }>(
  point: T,
  enabled: boolean,
  step = GRID_YARDS,
): { x: number; z: number } {
  return { x: snapValue(point.x, enabled, step), z: snapValue(point.z, enabled, step) };
}

/**
 * Which grid step to draw at this zoom.
 *
 * A 10 yard grid on a 1100 yard circuit zoomed out is a grey wash, so the step
 * multiplies up until the lines are at least a few pixels apart. Same rule every
 * plan view uses; it is here so the canvas holds no arithmetic of its own.
 */
export function gridStepAt(scale: number, minPixels = 12): number {
  // A scale of zero makes `step * scale` zero forever, so the loop would only
  // stop at its own ceiling and hand back a meaningless step. There is no grid to
  // draw at that scale anyway; `gridRange` refuses it.
  if (!(scale > 0)) return GRID_YARDS;
  let step = GRID_YARDS;
  while (step * scale < minPixels && step < GRID_YARDS * 1000) step *= 5;
  return step;
}

/** The most grid lines one axis will ever draw. A ceiling, not a design: past
 *  this the grid is a solid wash and something upstream is wrong. */
export const MAX_GRID_LINES = 400;

/**
 * Where the grid runs across one axis, or null when there is no grid to draw.
 *
 * Null rather than a best effort, and this is the whole point of the function.
 * A zero scale makes the visible span infinite, and `for (let x = -Infinity; x <=
 * Infinity; x += step)` never advances: it froze the page at 100 percent CPU on
 * the first frame, because the plan's measured size is zero until the first
 * animation frame and the view had already been fitted against it. A drawing
 * routine must not be the thing that decides whether its own inputs are sane.
 */
export function gridRange(
  centre: number,
  sizePixels: number,
  scale: number,
  step: number,
): { first: number; last: number } | null {
  if (!(scale > 0) || !(sizePixels > 0) || !(step > 0)) return null;
  const half = sizePixels / (2 * scale);
  const first = Math.ceil((centre - half) / step) * step;
  const last = centre + half;
  if (!Number.isFinite(first) || !Number.isFinite(last)) return null;
  if ((last - first) / step > MAX_GRID_LINES) return null;
  return { first, last };
}

export type ChipTone = 'plain' | 'good' | 'warn' | 'bad';

export interface HeadlineChip {
  id: string;
  label: string;
  value: string;
  unit: string;
  tone: ChipTone;
  title: string;
}

/**
 * The three numbers worth having on screen at all times.
 *
 * The whole readout moved behind a drawer, so these are what is left in the eye
 * line: how long the lap is, whether any corner folds its own road, and how much
 * is standing on the circuit.
 */
export function headlineChips(metrics: RealmRacersCircuitMetrics): HeadlineChip[] {
  const ratio = metrics.minRadiusOverWidth;
  return [
    {
      id: 'lap',
      label: 'lap',
      value: metrics.lapLength.toFixed(1),
      unit: 'yd',
      tone: 'plain',
      title: `${metrics.sampleCount} samples around the lap`,
    },
    {
      id: 'tightest',
      label: 'tightest',
      value: ratio.toFixed(2),
      unit: 'r/w',
      // The sim's own two thresholds, imported the way `width_fix_core.ts`
      // imports them. Re-typing 1 and 1.5 here would be a rule the game does not
      // share: move the readout's warn floor and the chip would tint a corner
      // green that the readout is already complaining about.
      tone:
        ratio < REALM_RACERS_RADIUS_OVER_WIDTH_FLOOR
          ? 'bad'
          : ratio < REALM_RACERS_RADIUS_OVER_WIDTH_WARN
            ? 'warn'
            : 'good',
      title: `corner radius over road half-width, at ${metrics.minRadiusOverWidthAtS.toFixed(0)} yd; under ${REALM_RACERS_RADIUS_OVER_WIDTH_WARN} is tight, under ${REALM_RACERS_RADIUS_OVER_WIDTH_FLOOR} folds the road`,
    },
    {
      id: 'props',
      label: 'props',
      value: String(metrics.propCount),
      unit: '',
      tone: 'plain',
      title: `${metrics.propCount} placed, ${metrics.scatterCount} scattered, ${metrics.pondCount} pond(s)`,
    },
  ];
}

// ---- problems ----

export const PROBLEM_LABELS: Record<RealmRacersCircuitProblemCode, string> = {
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
  pond_on_racing_surface: 'a pond reaches onto the racing surface',
  pickup_row_off_road: 'a pickup row does not fit on the road there',
  pickup_row_lanes_overlap: 'a pickup row is narrow enough that its boxes overlap',
};

export function problemHeadline(problem: RealmRacersCircuitProblem): string {
  const label = PROBLEM_LABELS[problem.code];
  return problem.axis ? `${label} (${problem.axis})` : label;
}

export function problemDetail(problem: RealmRacersCircuitProblem): string {
  const where = problem.s >= 0 ? ` at ${problem.s.toFixed(0)} yd` : '';
  return `${problem.value.toFixed(2)} against ${problem.limit.toFixed(2)}${where}`;
}

export interface ProblemsChip {
  text: string;
  tone: 'clean' | 'warn' | 'bad';
  /**
   * The problem the chip points at, or null.
   *
   * Returned rather than left for the caller to re-derive: the shell was picking
   * the same `find(error) ?? [0]` again to decide what a click focuses, so
   * changing the tie-break here would have made the chip's TEXT and its TARGET
   * disagree. Null when there is nothing to focus, which includes a problem with
   * no location.
   */
  focus: RealmRacersCircuitProblem | null;
}

/**
 * The status bar's left end.
 *
 * It names the WORST problem rather than counting quietly: "3 problems" sends
 * the operator opening a drawer to find out whether any of them stops the race,
 * and the answer is one word long.
 */
export function problemsChip(problems: readonly RealmRacersCircuitProblem[]): ProblemsChip {
  if (problems.length === 0) return { text: 'no problems', tone: 'clean', focus: null };
  const worst = problems.find((problem) => problem.severity === 'error') ?? problems[0];
  const count = problems.length === 1 ? '1 problem' : `${problems.length} problems`;
  return {
    text: `${count} - ${problemHeadline(worst)}`,
    tone: worst.severity === 'error' ? 'bad' : 'warn',
    focus: worst.s >= 0 ? worst : null,
  };
}

/** How many callouts the plan carries before the rest are markers only. */
export const MAX_CANVAS_CALLOUTS = 4;

/**
 * The problems that get a callout pinned on the plan, worst first.
 *
 * Located ones only, because a callout's whole job is to say WHERE: a whole-loop
 * fault (the winding, the theme) has no point to pin to and reads in the chip and
 * the drawer instead. Capped, since a freshly drawn loop can carry thirty and
 * thirty callouts hide the circuit they are about.
 */
export function calloutProblems(
  problems: readonly RealmRacersCircuitProblem[],
  limit = MAX_CANVAS_CALLOUTS,
): RealmRacersCircuitProblem[] {
  const located = problems.filter((problem) => problem.s >= 0);
  const errors = located.filter((problem) => problem.severity === 'error');
  const warnings = located.filter((problem) => problem.severity === 'warning');
  return [...errors, ...warnings].slice(0, Math.max(0, limit));
}

/** How much vertical room a callout box needs before the next one, pixels. */
export const CALLOUT_MIN_GAP = 40;

/**
 * How far right of its anchor a callout box reaches, pixels: the offset the
 * sheet translates it by plus its own max width.
 *
 * A number rather than a measurement, because the decision has to be made
 * BEFORE the box exists and measuring one would be a forced reflow inside the
 * paint. It is the sheet's `button.callout` geometry, and the sheet says so.
 */
export const CALLOUT_REACH = 274;

/** Where a callout box sits, and which side of its anchor it opens on. */
export interface CalloutAnchor {
  x: number;
  y: number;
  /** True when the box opens to the LEFT because it would run off the plan. */
  flip: boolean;
}

export interface CalloutSpreadOptions {
  gap?: number;
  /** The plan's pixel width, or 0 to never flip (nothing to run off). */
  planWidth?: number;
}

/**
 * Callout anchors nudged apart, and flipped to the near side at the edge.
 *
 * Two faults a few yards apart project to nearly the same pixel, and two boxes
 * on the same pixel are one unreadable box: the second corner of a chicane hid
 * behind the first. The canvas marker still rings the true spot, so the box is
 * the thing allowed to move. Nulls (off-plan) pass through untouched, and the
 * order of the input is preserved: the caller's list is worst-first.
 *
 * The flip is the other half of the same idea. Boxes only ever opened rightward,
 * so a problem near the plan's right edge wrote its explanation off the screen:
 * the ONE case where a callout says nothing at all. Deciding it here rather than
 * in the shell keeps it testable, which the y nudge already was.
 */
export function spreadCallouts<T extends { x: number; y: number }>(
  anchors: readonly (T | null)[],
  options: CalloutSpreadOptions = {},
): (CalloutAnchor | null)[] {
  const gap = options.gap ?? CALLOUT_MIN_GAP;
  const planWidth = options.planWidth ?? 0;
  // Flipped only when it HELPS: the box runs off the right AND there is room for
  // it on the left. On a plan narrower than one box, both sides overflow and the
  // near edge is the one the marker is on, so flipping there would trade the
  // right-edge defect for its mirror.
  const flips = (x: number): boolean =>
    planWidth > 0 && x + CALLOUT_REACH > planWidth && x >= CALLOUT_REACH;
  const out: (CalloutAnchor | null)[] = anchors.map((anchor) =>
    anchor ? { x: anchor.x, y: anchor.y, flip: flips(anchor.x) } : null,
  );
  const order = out
    .filter((anchor): anchor is CalloutAnchor => anchor !== null)
    .sort((a, b) => a.y - b.y);
  let floor = Number.NEGATIVE_INFINITY;
  for (const anchor of order) {
    anchor.y = Math.max(anchor.y, floor);
    floor = anchor.y + gap;
  }
  return out;
}

// ---- the contextual right panel ----

/**
 * Which tabs a mode even HAS: the dressing tools' three, and nothing anywhere
 * else.
 *
 * Contextual means contextual. All three arm or edit a piece of DRESSING, so all
 * three are dead in a tool that places none: the outliner listing props at an
 * operator painting a road was the same mistake as the library offering pieces to
 * a tool that cannot place them. What those modes show instead is `MODE_READOUT`,
 * the measurements their own tool changes. RACE has none either: the enclosure and
 * the race numbers ARE the panel there, and a tab strip over a form the mode
 * exists to show is a click that decides nothing.
 */
export function sideTabsFor(mode: RailModeId): readonly SideTabId[] {
  return mode === 'props' ? ['library', 'inspector', 'outliner'] : [];
}

/** Which tab the panel opens on when the operator has not picked one. */
export function autoSideTab(
  mode: RailModeId,
  hasSelection: boolean,
  isPlacing = false,
): SideTabId | null {
  const tabs = sideTabsFor(mode);
  if (tabs.length === 0) return null;
  if (hasSelection && !isPlacing && tabs.includes('inspector')) return 'inspector';
  return tabs[0];
}

export const SIDE_TAB_LABELS: Record<SideTabId, string> = {
  library: 'Library',
  inspector: 'Inspector',
  outliner: 'Outliner',
};
