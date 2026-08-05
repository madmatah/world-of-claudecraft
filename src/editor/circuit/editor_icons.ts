// The circuit editor's icons: inline SVG, one export per action and rail mode.
//
// Inline strings in one module rather than an icon font, a sprite sheet or files
// under `public/`: this page is a dev tool that no production build emits, so an
// external asset would be a request that only ever resolves under `npm run dev`,
// and a glyph font would be a dependency for twenty shapes.
//
// House style, so a rail of them reads as one set: a 16 unit grid, `currentColor`
// on a single 1.5 stroke with round caps and joins, no fills, and nothing that
// needs a second colour. The eye judges the shapes; the table check in
// `tests/editor_circuit_icons.test.ts` only pins that every action has one and
// that no icon here is dead.

export type EditorIconId =
  | 'file'
  | 'folder'
  | 'save'
  | 'clipboard'
  | 'undo'
  | 'redo'
  | 'cube'
  | 'fullscreen'
  | 'gauge'
  | 'grid'
  | 'magnet'
  | 'frame'
  | 'zoom'
  | 'zoomIn'
  | 'zoomOut'
  | 'box'
  | 'wrench'
  | 'flag'
  | 'shape'
  | 'width'
  | 'props'
  | 'keyboard'
  | 'trash'
  | 'duplicate'
  | 'target'
  | 'rotate'
  | 'tangent'
  | 'plus'
  | 'minus'
  | 'collide'
  | 'move'
  | 'close'
  | 'warning'
  | 'orbit'
  | 'fly'
  | 'pickupRow'
  | 'terrain'
  | 'center';

const svg = (body: string): string =>
  `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;

export const EDITOR_ICONS: Record<EditorIconId, string> = {
  file: svg('<path d="M4 2h5l3 3v9H4z" /><path d="M9 2v3h3" />'),
  folder: svg('<path d="M2 4.5h4l1.5 2H14V13H2z" />'),
  save: svg(
    '<path d="M2.5 2.5h8L13.5 5.5v8h-11z" /><path d="M5.5 2.5v4h5" /><path d="M5 13.5v-4h6v4" />',
  ),
  clipboard: svg(
    '<rect x="5" y="2.5" width="6" height="2.5" rx="1" /><path d="M5.5 4H4v9.5h8V4h-1.5" />',
  ),
  undo: svg('<path d="M6 5.5H10a3 3 0 0 1 0 6H5" /><path d="M8 3 5.5 5.5 8 8" />'),
  redo: svg('<path d="M10 5.5H6a3 3 0 0 0 0 6h5" /><path d="M8 3l2.5 2.5L8 8" />'),
  cube: svg(
    '<path d="M8 2 14 5.2v5.6L8 14 2 10.8V5.2z" /><path d="M2 5.2 8 8.4l6-3.2" /><path d="M8 8.4V14" />',
  ),
  fullscreen: svg(
    '<path d="M6 2.5H2.5V6" /><path d="M10 2.5h3.5V6" /><path d="M6 13.5H2.5V10" /><path d="M10 13.5h3.5V10" />',
  ),
  gauge: svg('<path d="M2.5 11a5.5 5.5 0 1 1 11 0" /><path d="M8 11 11 6.5" />'),
  grid: svg(
    '<path d="M2.5 6h11" /><path d="M2.5 10h11" /><path d="M6 2.5v11" /><path d="M10 2.5v11" />',
  ),
  magnet: svg('<path d="M4 3v5a4 4 0 0 0 8 0V3" /><path d="M4 7h3" /><path d="M9 7h3" />'),
  frame: svg(
    '<rect x="2.5" y="3.5" width="11" height="9" rx="1" /><path d="M5.5 3.5v9" /><path d="M10.5 3.5v9" />',
  ),
  zoom: svg('<circle cx="7" cy="7" r="4" /><path d="M10 10l3.5 3.5" />'),
  zoomIn: svg(
    '<circle cx="7" cy="7" r="4" /><path d="M10 10l3.5 3.5" /><path d="M5.5 7h3" /><path d="M7 5.5v3" />',
  ),
  zoomOut: svg('<circle cx="7" cy="7" r="4" /><path d="M10 10l3.5 3.5" /><path d="M5.5 7h3" />'),
  box: svg(
    '<rect x="2.5" y="2.5" width="11" height="11" rx="1" /><rect x="5.5" y="5.5" width="5" height="5" />',
  ),
  wrench: svg(
    '<path d="M10.5 2.5a3 3 0 0 0-2.4 4.8L3 12.4 4.6 14l5.1-5.1a3 3 0 0 0 3.8-3.8l-1.9 1.9-1.6-1.6z" />',
  ),
  flag: svg('<path d="M4.5 2.5v11" /><path d="M4.5 3.5h8l-1.6 2.6L12.5 8.7h-8z" />'),
  shape: svg(
    '<path d="M2.5 11c2-6 4.5 1 6.5-2.5S13 3 13.5 5" /><circle cx="2.5" cy="11" r="1.3" /><circle cx="13.5" cy="5" r="1.3" />',
  ),
  width: svg(
    '<path d="M2.5 4.5h11" /><path d="M2.5 11.5h11" /><path d="M8 6v4" /><path d="M6.5 7.5 8 6l1.5 1.5" /><path d="M6.5 8.5 8 10l1.5-1.5" />',
  ),
  props: svg(
    '<rect x="2.5" y="2.5" width="5" height="5" /><rect x="8.5" y="8.5" width="5" height="5" /><rect x="8.5" y="2.5" width="5" height="5" />',
  ),
  keyboard: svg(
    '<rect x="2" y="4.5" width="12" height="7" rx="1" /><path d="M4.5 7h.01" /><path d="M7 7h.01" /><path d="M9.5 7h.01" /><path d="M12 7h.01" /><path d="M5 9.5h6" />',
  ),
  trash: svg(
    '<path d="M3.5 4.5h9" /><path d="M6 4.5V3h4v1.5" /><path d="M4.5 4.5 5 13.5h6l.5-9" />',
  ),
  duplicate: svg(
    '<rect x="5.5" y="5.5" width="8" height="8" rx="1" /><path d="M10.5 5.5v-3h-8v8h3" />',
  ),
  target: svg(
    '<circle cx="8" cy="8" r="4" /><path d="M8 1.5v2" /><path d="M8 12.5v2" /><path d="M1.5 8h2" /><path d="M12.5 8h2" />',
  ),
  rotate: svg('<path d="M13 8a5 5 0 1 1-1.8-3.85" /><path d="M13.5 2.5V5H11" />'),
  tangent: svg('<path d="M2.5 11.5c3.5 0 6-6 11-6" /><path d="M11 3.5l2.5 2-2.5 2" />'),
  plus: svg('<path d="M8 3.5v9" /><path d="M3.5 8h9" />'),
  minus: svg('<path d="M3.5 8h9" />'),
  collide: svg(
    '<circle cx="8" cy="8" r="3" /><path d="M8 2v1.5" /><path d="M8 12.5V14" /><path d="M2 8h1.5" /><path d="M12.5 8H14" />',
  ),
  move: svg(
    '<path d="M8 2.5v11" /><path d="M2.5 8h11" /><path d="M6 4.5 8 2.5l2 2" /><path d="M6 11.5 8 13.5l2-2" /><path d="M4.5 6 2.5 8l2 2" /><path d="M11.5 6l2 2-2 2" />',
  ),
  close: svg('<path d="M4 4l8 8" /><path d="M12 4l-8 8" />'),
  warning: svg('<path d="M8 2.5 14 13H2z" /><path d="M8 6.5v3" /><path d="M8 11h.01" />'),
  orbit: svg('<circle cx="8" cy="8" r="2" /><ellipse cx="8" cy="8" rx="6" ry="2.6" />'),
  fly: svg('<path d="M2.5 12.5c4-1 6-4.5 11-9.5" /><path d="M9 3h4.5v4.5" />'),
  // What the record actually is: four boxes spread across the road, with the
  // clear strip either side that keeps shaving a border a way to dodge the row
  // on purpose. Drawn as ticks rather than as little squares because at sixteen
  // pixels a 1.5 stroke around a two-unit box is all stroke and no box.
  pickupRow: svg(
    '<path d="M3 2v12" /><path d="M13 2v12" /><path d="M4 8h1" /><path d="M6.4 8h1" /><path d="M8.8 8h1" /><path d="M11.2 8h1" />',
  ),
  // A run of fence with its posts: the rail across the top, the uprights under
  // it, and the corner it turns.
  terrain: svg(
    '<path d="M2 5.5h7l3.5 3.5" /><path d="M4 5.5v6" /><path d="M7 5.5v6" /><path d="M9 5.5v6" /><path d="M12.5 9v3" />',
  ),
  // A shape pulled to the middle of its box.
  center: svg(
    '<rect x="2.5" y="2.5" width="11" height="11" rx="1" /><circle cx="8" cy="8" r="2.5" /><path d="M8 2.5v1.5" /><path d="M8 12v1.5" /><path d="M2.5 8H4" /><path d="M12 8h1.5" />',
  ),
};

/**
 * Icons the CHROME draws rather than an action: the two close buttons and the
 * problems badge have no row in the action table, so the completeness test would
 * call them dead without this list. `pickupRow` is here for the same reason from
 * the other side: it faces a PALETTE tile, and what a palette offers is not an
 * action any more than a library tile is. Nothing else belongs here; an icon that
 * is neither referenced nor listed is dead weight, which is the whole check.
 */
export const CHROME_ONLY_ICONS: readonly EditorIconId[] = ['warning', 'pickupRow'];

export function editorIcon(id: EditorIconId): string {
  return EDITOR_ICONS[id];
}
