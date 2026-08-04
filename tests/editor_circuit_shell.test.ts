// @vitest-environment jsdom
//
// The circuit editor's chrome, driven against the REAL markup.
//
// `shell.ts` is structure over `layout_core.ts` and has no test of its own, which
// is right for the parts that are only elements. Three of its behaviours are not:
// escape closing an open menu (and giving the keyboard back), the tool-options
// strip hiding with the field it exists for, and the side-tab strip disappearing
// below two tabs. All three are claims about what the operator sees, all three
// regress silently, and none of them can be read off the core.
//
// The document is `circuit_editor.html`'s own body rather than a fixture: the
// shell resolves twenty-odd elements by id, and a hand-built tree would be a
// second copy of the markup free to disagree with the page.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TOOL_VALUE_FIELDS } from '../src/editor/circuit/layout_core';
import { EditorShell, type ShellHost } from '../src/editor/circuit/shell';

const html = readFileSync(resolve(import.meta.dirname, '../circuit_editor.html'), 'utf8');
const body = html.slice(html.indexOf('<body>') + '<body>'.length, html.indexOf('</body>'));

function mountShell(): { shell: EditorShell; host: ShellHost } {
  // The `<script type="module">` in there does NOT run: scripts inserted through
  // innerHTML never execute, which is exactly what this test wants.
  document.body.innerHTML = body;
  const host: ShellHost = {
    onAction: vi.fn(),
    onMode: vi.fn(),
    onSideTab: vi.fn(),
    onFocusProblem: vi.fn(),
    onToolValue: vi.fn(),
  };
  return { shell: new EditorShell(host, 'other'), host };
}

const el = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;

describe('the circuit editor shell, on the real markup', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('resolves every element it looks up, and builds its four surfaces', () => {
    // The floor: a constructor that threw would make every case below vacuous.
    expect(() => mountShell()).not.toThrow();
    expect(document.querySelectorAll('#menus details').length).toBe(4);
    expect(document.querySelectorAll('#railTop button.rail-btn').length).toBe(4);
    expect(document.querySelectorAll('#keysBody .keys-block').length).toBeGreaterThan(0);
    expect(el('chordHints').textContent).toContain('undo');
  });

  it('closes an open menu on escape and hands the keyboard back to its summary', () => {
    const { host } = mountShell();
    // The page's own escape (pointer, drop the selection) listens on WINDOW. The
    // shell listens on DOCUMENT so it runs first and stops the propagation, or
    // backing out of a menu would also throw away the operator's selection.
    const pageEscape = vi.fn();
    window.addEventListener('keydown', pageEscape);

    const menu = document.querySelector('#menus details') as HTMLDetailsElement;
    const summary = menu.querySelector('summary') as HTMLElement;
    menu.open = true;
    menu.dispatchEvent(new Event('toggle'));

    // Dispatched on the BODY, the way a real keystroke arrives: it bubbles
    // through document (where the shell listens) on its way to window (where the
    // page listens), which is the ordering the fix depends on.
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(menu.open).toBe(false);
    expect(document.activeElement).toBe(summary);
    expect(
      pageEscape,
      'the page escape must not fire underneath the menu one',
    ).not.toHaveBeenCalled();
    expect(host.onAction).not.toHaveBeenCalled();
    window.removeEventListener('keydown', pageEscape);
  });

  it('leaves escape alone when no menu is open, so the page still gets it', () => {
    // The other arm, and the one that matters more: swallowing every escape
    // would leave `disarmTool` unreachable from the keyboard.
    mountShell();
    const pageEscape = vi.fn();
    window.addEventListener('keydown', pageEscape);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(pageEscape).toHaveBeenCalledTimes(1);
    window.removeEventListener('keydown', pageEscape);
  });

  it('opens one menu at a time', () => {
    mountShell();
    const menus = [...document.querySelectorAll('#menus details')] as HTMLDetailsElement[];
    menus[0].open = true;
    menus[0].dispatchEvent(new Event('toggle'));
    menus[1].open = true;
    menus[1].dispatchEvent(new Event('toggle'));
    expect(menus[0].open).toBe(false);
    expect(menus[1].open).toBe(true);
  });

  it('hides the whole options strip with the field, not just the field', () => {
    // The defect: `#toolOptions` kept its padding in every mode with no value
    // field, so an empty band sat above the panel body in shape, handles and
    // race, which reads as a control that failed to render.
    const { shell } = mountShell();
    const field = TOOL_VALUE_FIELDS.width;
    expect(field).not.toBeNull();
    if (!field) return;

    shell.setToolValueField(field, true);
    expect(el('toolValueLabel').hidden).toBe(false);
    expect(el('toolOptions').hidden).toBe(false);

    shell.setToolValueField(null);
    expect(el('toolValueLabel').hidden).toBe(true);
    expect(el('toolOptions').hidden).toBe(true);

    // A field the ACTIVE PANEL does not own hides too: the scatter spacing is
    // the library's and had no reason to hang over the inspector.
    shell.setToolValueField(field, false);
    expect(el('toolValueLabel').hidden).toBe(true);
    expect(el('toolOptions').hidden).toBe(true);
  });

  it('re-ranges the value field per tool, and clamps what the box already held', () => {
    const { shell } = mountShell();
    const width = TOOL_VALUE_FIELDS.width;
    const props = TOOL_VALUE_FIELDS.props;
    if (!width || !props) return;
    const input = el('toolValue') as HTMLInputElement;

    input.value = String(width.max + 100);
    shell.setToolValueField(width);
    expect(input.min).toBe(String(width.min));
    expect(input.max).toBe(String(width.max));
    expect(input.value).toBe(String(width.max));

    input.value = '';
    shell.setToolValueField(props);
    // An emptied box used to reach `Math.max(min, NaN)` and write "NaN".
    expect(input.value).toBe(String(props.min));
  });

  it('shows the tab strip only where the mode has a choice to make', () => {
    const { shell } = mountShell();
    shell.setSideTab(['library', 'inspector', 'outliner'], 'library');
    expect(el('sideTabs').hidden).toBe(false);
    shell.setSideTab(['library'], 'library');
    expect(el('sideTabs').hidden).toBe(true);
    shell.setSideTab([], null);
    expect(el('sideTabs').hidden).toBe(true);
  });

  it('says one sentence per preview state on the dot', () => {
    const { shell } = mountShell();
    shell.setPreviewReady('ready');
    expect(el('readyDot').className).toBe('dot ready');
    expect(el('readyDot').title).toContain('live on this record');
    shell.setPreviewReady('error');
    expect(el('readyDot').title).toContain('could not start');
    shell.setPreviewReady('off');
    expect(el('readyDot').title).toContain('not open');
  });

  it('flips a callout to the near side when the plan runs out of room', () => {
    // The core decides it; this is the half that proves the shell renders the
    // decision, since a `flip` nothing ever puts on an element is a dead rule.
    const { shell } = mountShell();
    const problem = {
      code: 'corner_folds_road',
      severity: 'error',
      value: 0.8,
      limit: 1,
      s: 120,
    } as const;
    shell.setProblems([problem], [problem], () => ({ x: 960, y: 100 }), 1000);
    expect(document.querySelectorAll('#callouts button.flip').length).toBe(1);
    shell.setProblems([problem], [problem], () => ({ x: 100, y: 100 }), 1000);
    expect(document.querySelectorAll('#callouts button').length).toBe(1);
    expect(document.querySelectorAll('#callouts button.flip').length).toBe(0);
  });
});
