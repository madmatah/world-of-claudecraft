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
import { CALLOUT_REACH } from '../src/editor/circuit/layout_core';
import { PLAN_PALETTE_FALLBACK, PLAN_PALETTE_VARS } from '../src/editor/circuit/plan_core';
import { expectScansOnlyThroughSharedWalkers } from './helpers/scan_guard_self_audit';
import { tsFilesUnder } from './helpers/ts_files_under';

const repoRoot = resolve(import.meta.dirname, '..');
const html = readFileSync(resolve(repoRoot, 'circuit_editor.html'), 'utf8');

/**
 * Every module of the page, walked rather than listed.
 *
 * It WAS a hand-kept three (`main.ts`, `shell.ts`, `dock.ts`), and the workbench
 * pass moved most of the element construction into six new `panel_*` modules,
 * which walked straight out of a scan that named files. A walk cannot be
 * out-grown that way. The cores come along for the ride: they hold no
 * `getElementById` and no `.hidden =`, so including them narrows nothing and
 * pins the next DOM module automatically.
 */
const files = tsFilesUnder(resolve(repoRoot, 'src/editor/circuit'));
const sources = files.map((entry) => readFileSync(entry.full, 'utf8'));

/**
 * The DOM modules alone, for the CLASS sweep only.
 *
 * A class earns its keep by being carried by something that builds an element,
 * and a core is not that: `layout_core.ts` holds the string `'warn'` as a chip
 * TONE, which would credit the `.warn` rule without any element ever wearing it.
 * The other two sweeps want the whole directory; this one wants the half that
 * writes to the DOM.
 */
const domSources = files
  .filter((entry) => !entry.file.endsWith('_core.ts'))
  .map((entry) => readFileSync(entry.full, 'utf8'));

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

describe('the circuit editor page guard itself', () => {
  it('walks the module tree through the shared walker and nothing else', () => {
    // The companion `tests/CLAUDE.md` requires beside a shared walk: the walk
    // fixes the narrowing, this stops a second hand-rolled `readdirSync` landing
    // beside it later and quietly covering less.
    expectScansOnlyThroughSharedWalkers(import.meta.url, ['ts_files_under']);
  });

  it('reads a corpus big enough to be the real directory', () => {
    // A vacuity floor. A walk that came back short (a moved directory, a bad
    // root) would pass every sweep below it over almost nothing.
    expect(files.length).toBeGreaterThanOrEqual(18);
    expect(domSources.length).toBeGreaterThanOrEqual(8);
    expect(files.map((entry) => entry.file)).toContain('main.ts');
    expect(files.map((entry) => entry.file)).toContain('panel_form.ts');
  });
});

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
    '#toolOptions',
    '#toolValueLabel',
    '.field',
    '#resumeOffer',
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

  it('holds the same hex for every token the canvas borrows', () => {
    // The duplication `plan_core.ts` exists to make safe. Comparing the fallback
    // to itself (which is all the plan-core test can do) leaves retinting a
    // token in the sheet with the canvas still painting the old colour, which is
    // the exact drift the module was written to end.
    const root = rules().find((rule) => rule.selector === ':root');
    expect(root, 'the sheet declares its tokens on :root').toBeDefined();
    const declared = new Map(
      [...(root?.body ?? '').matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((match) => [
        match[1],
        match[2].trim(),
      ]),
    );
    expect(declared.size).toBeGreaterThan(10);
    for (const [id, property] of Object.entries(PLAN_PALETTE_VARS)) {
      expect(
        declared.get(property),
        `${property} is what the canvas draws ${id} with, so the fallback has to be the same colour`,
      ).toBe(PLAN_PALETTE_FALLBACK[id as keyof typeof PLAN_PALETTE_FALLBACK]);
    }
  });

  it('adds the callout box up to the reach the flip is decided on', () => {
    // `CALLOUT_REACH` is a cross-file number: it IS this rule's offset plus its
    // width, and the flip test computes both of its boundary inputs from the
    // constant, so nothing on that side would notice it drifting from the sheet.
    const callout = rules().find((rule) => rule.selector === 'button.callout');
    expect(callout, 'the sheet styles the callout box').toBeDefined();
    const offset = /translate\((\d+)px/.exec(callout?.body ?? '');
    const width = /max-width:\s*(\d+)px/.exec(callout?.body ?? '');
    expect(offset?.[1], 'the callout is offset by a pixel amount').toBeDefined();
    expect(width?.[1], 'the callout is capped in PX, not in a font-relative unit').toBeDefined();
    expect(Number(offset?.[1]) + Number(width?.[1])).toBe(CALLOUT_REACH);
  });

  it('lets the dock scrubber take its resolution from the module, not the markup', () => {
    // `DOCK_SCRUB_STEPS` is the range's max AND the divisor its value is read
    // back through. A `max` left in the markup is a third copy, and the failure
    // is silent and asymmetric: drop the module's write and the range falls back
    // to the HTML default of 100, so the scrubber addresses a tenth of the lap
    // with no error anywhere.
    const range = /<input\b[^>]*id="dockRange"[^>]*>/s.exec(html);
    expect(range, 'the dock has a scrubber').not.toBeNull();
    expect(range?.[0]).not.toMatch(/\bmax\s*=/);
    expect(range?.[0]).toMatch(/\bmin\s*=/);
  });

  it('accounts for every element the modules hide', () => {
    // The count is what catches a NEW `.hidden =` arriving without a look at the
    // stylesheet: it fails, and whoever added it either extends the list above or
    // confirms the element has no display rule.
    // Comments come OFF first. One of them quoted an assignment verbatim, which
    // made a prose edit break a pin about the stylesheet: a false alarm trains
    // people to bump the number without opening the sheet, which is the one
    // thing this pin exists to make them do.
    const assignments = sources.flatMap((source) => [
      ...source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1')
        .matchAll(/([A-Za-z][\w.]*)\.hidden\s*=/g),
    ]);
    expect(assignments.length).toBe(27);
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

  it('has an element for every class its stylesheet styles', () => {
    // The regression this exists for: a restructure wrote the CSS for a new
    // `.plan-head` wrapper and the markup edit silently did not apply, so three
    // overlays lost the `position: absolute` those rules had replaced and fell
    // behind a full-height canvas. Nothing was hidden, nothing failed to resolve,
    // and every other test stayed green.
    //
    // A class earns its keep by appearing in the markup OR as a literal in a
    // module that BUILDS an element (the cores are excluded: `layout_core.ts`
    // holds `'warn'` as a chip tone, which would credit the `.warn` rule with no
    // element ever wearing it). Deliberately loose about WHERE in the module:
    // the classes arrive through `el()`, `actionButton()`, `className =` and
    // `classList.toggle`, and a regex per call shape would be the thing that rots.
    // The failure it has to catch is a class that appears in NEITHER, which is
    // exactly what `.plan-head` was.
    const moduleText = domSources.join('\n');
    const styled = new Set(
      rules()
        .flatMap((rule) => [...rule.selector.matchAll(/\.([a-zA-Z][\w-]*)/g)])
        .map((match) => match[1]),
    );
    const inMarkup = new Set(
      [...html.matchAll(/class="([^"]+)"/g)].flatMap((match) => match[1].split(/\s+/)),
    );
    expect(styled.size).toBeGreaterThan(20);
    for (const name of styled) {
      const carried =
        inMarkup.has(name) ||
        moduleText.includes(`'${name}'`) ||
        new RegExp(`'[^']*\\b${name}\\b[^']*'`).test(moduleText);
      expect(
        carried,
        `.${name} is styled but no element in the markup or the modules ever carries it`,
      ).toBe(true);
    }
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
