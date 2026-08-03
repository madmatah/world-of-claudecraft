// The circuit editor PAGE: the one contract between its inline stylesheet and the
// modules that hide its elements.
//
// This exists because of a bug class that has cost this page four times. An author
// rule that sets `display` OUTRANKS the browser's own `[hidden] { display: none }`,
// so `element.hidden = true` silently does nothing and the element stays on screen.
// It cost `#empty`, then the old `#preview`, then the practice rows (`.field`) and
// the per-mode repair chips (`button.chip`) in the same commit. Prose in a
// CLAUDE.md did not stop the third and fourth; this does.
//
// The page is a DEV tool absent from every production build, so nothing else in the
// suite reads it: `tests/css_corpus.test.ts` and the `src/styles` guards cover the
// game's sheets, and this stylesheet is inline in a root-level HTML file outside
// all of them.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(import.meta.dirname, '..');
const html = readFileSync(resolve(repoRoot, 'circuit_editor.html'), 'utf8');

/** The page's modules, which are the only things that hide its elements. */
const MODULES = ['main.ts', 'shell.ts', 'dock.ts'] as const;
const sources = MODULES.map((name) =>
  readFileSync(resolve(repoRoot, 'src/editor/circuit', name), 'utf8'),
);

/** The stylesheet, which is inline: one `<style>` block in the head. */
function stylesheet(): string {
  const open = html.indexOf('<style>');
  const close = html.indexOf('</style>');
  expect(open, 'the page has one inline <style> block').toBeGreaterThan(-1);
  expect(close).toBeGreaterThan(open);
  return html.slice(open + '<style>'.length, close);
}

/**
 * Every rule in it, as a selector plus its declarations.
 *
 * Comments come off FIRST. This sheet documents nearly every rule it carries, and
 * a comment sitting above a selector is part of the text between the previous `}`
 * and the next `{`, so a parser that keeps them reads `#dock` as a paragraph and
 * matches nothing.
 */
function rules(): { selector: string; body: string }[] {
  const out: { selector: string; body: string }[] = [];
  const sheet = stylesheet().replace(/\/\*[\s\S]*?\*\//g, '');
  // Flat rules only, which is all this sheet has: no `@media`, no nesting. If one
  // is ever added, the count floor below fails and this parser gets revisited.
  for (const match of sheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    out.push({ selector: match[1].trim().replace(/\s+/g, ' '), body: match[2] });
  }
  return out;
}

const declaresDisplay = (body: string): boolean => /(^|;|\s)display\s*:/.test(body);

describe('the circuit editor page stylesheet', () => {
  it('parses as a flat sheet, with enough rules to be the real one', () => {
    // A vacuity floor: a parser that silently matched nothing would pass every
    // assertion below it.
    const parsed = rules();
    expect(parsed.length).toBeGreaterThan(80);
    expect(stylesheet()).not.toContain('@media');
    expect(parsed.some((rule) => rule.selector === '#dock')).toBe(true);
  });

  /**
   * Every element the page hides, resolved to the selector its rules are written
   * under. Hand-kept BY DESIGN: resolving a DOM variable to a selector statically
   * is not something a regex should be trusted with, and the list is short. What
   * keeps it honest is the count pin below plus the reverse sweep: a new
   * `.hidden =` in the page shows up as a bare count mismatch.
   */
  const HIDDEN_SELECTORS = [
    '#docDirty',
    '#empty',
    '#banner',
    '#modeActions',
    'button.chip',
    '#headline',
    '#metricsDrawer',
    '#dock',
    '#sideTabs',
    'button.side-tab',
    '#toolValueLabel',
    '.field',
    '#paletteAllLabel',
  ] as const;

  it('guards every hidden element whose rules set a display', () => {
    const parsed = rules();
    for (const selector of HIDDEN_SELECTORS) {
      const sets = parsed.some((rule) => rule.selector === selector && declaresDisplay(rule.body));
      if (!sets) continue;
      const guarded = parsed.some(
        (rule) => rule.selector === `${selector}[hidden]` && /display\s*:\s*none/.test(rule.body),
      );
      expect(
        guarded,
        `${selector} sets display, so it needs a "${selector}[hidden] { display: none; }" rule beside it or hiding it does nothing`,
      ).toBe(true);
    }
  });

  it('has no [hidden] guard for an element nothing hides', () => {
    // The reverse direction, so the list above cannot rot into a list of guards
    // for elements that stopped being hidden.
    const guards = rules()
      .map((rule) => rule.selector)
      .filter((selector) => selector.endsWith('[hidden]'))
      .map((selector) => selector.slice(0, -'[hidden]'.length));
    for (const selector of guards) {
      expect(
        HIDDEN_SELECTORS as readonly string[],
        `${selector} is guarded but nothing hides it`,
      ).toContain(selector);
    }
  });

  it('accounts for every element the modules hide', () => {
    // The count is what catches a NEW `.hidden =` arriving without a look at the
    // stylesheet: it fails, and whoever added it either extends the list above or
    // confirms the element has no display rule.
    const assignments = sources.flatMap((source) => [
      ...source.matchAll(/([A-Za-z][\w.]*)\.hidden\s*=/g),
    ]);
    expect(assignments.length).toBe(22);
  });
});

describe('the circuit editor page markup', () => {
  it('is absent from the production build, which is what licenses its dev-tool carve-out', () => {
    const config = readFileSync(resolve(repoRoot, 'vite.config.ts'), 'utf8');
    const input = config.slice(config.indexOf('input: {'), config.indexOf('input: {') + 700);
    expect(input).not.toContain('circuit_editor');
    // The page it sits beside, to prove the slice really is the entry list.
    expect(input).toContain('editor.html');
  });

  it('resolves every element its modules look up', () => {
    // The other half of the same contract: a renamed container turns into a null
    // at boot, and the page throws before it draws anything.
    const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((match) => match[1]));
    expect(ids.size).toBeGreaterThan(40);
    for (const source of sources) {
      for (const match of source.matchAll(/getElementById\('([^']+)'\)/g)) {
        expect(ids, `#${match[1]} is looked up but the markup has no such element`).toContain(
          match[1],
        );
      }
    }
  });
});
