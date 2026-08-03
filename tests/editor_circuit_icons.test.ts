// The circuit editor's icon set, against the action table.
//
// A table check, never a pixel one: the eye judges whether an icon reads, and a
// test cannot. What it can hold is the two ways the set rots. An action whose
// icon id nothing draws renders an empty button, and an icon nobody references
// is dead weight that survives every later rename.

import { describe, expect, it } from 'vitest';
import {
  CHROME_ONLY_ICONS,
  EDITOR_ICONS,
  type EditorIconId,
  editorIcon,
} from '../src/editor/circuit/editor_icons';
import { EDITOR_ACTIONS, RAIL_MODES } from '../src/editor/circuit/layout_core';

const referenced = new Set<EditorIconId>([
  ...EDITOR_ACTIONS.map((action) => action.icon),
  ...RAIL_MODES.map((mode) => mode.icon),
]);

describe('the editor icon set', () => {
  it('draws every icon an action or a rail mode names', () => {
    for (const id of referenced) {
      expect(EDITOR_ICONS[id], id).toBeDefined();
      expect(editorIcon(id), id).toContain('<svg');
    }
  });

  it('has nothing dead: an unreferenced icon is declared chrome-only', () => {
    const chrome = new Set(CHROME_ONLY_ICONS);
    for (const id of Object.keys(EDITOR_ICONS) as EditorIconId[]) {
      expect(referenced.has(id) || chrome.has(id), `${id} is drawn by nothing`).toBe(true);
    }
  });

  it('keeps the chrome-only list honest: nothing in it is also an action icon', () => {
    for (const id of CHROME_ONLY_ICONS) expect(referenced.has(id), id).toBe(false);
  });

  it('holds every icon to the house style, so a rail of them reads as one set', () => {
    for (const [id, markup] of Object.entries(EDITOR_ICONS)) {
      expect(markup, id).toContain('viewBox="0 0 16 16"');
      expect(markup, id).toContain('stroke="currentColor"');
      expect(markup, id).toContain('aria-hidden="true"');
      // No fills and no baked colours: the button's own colour is the icon's.
      expect(markup, id).toContain('fill="none"');
      expect(markup, id).not.toMatch(/#[0-9a-f]{3,6}/i);
    }
  });
});
