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
import { CALLOUT_REACH, MODE_ACTIONS, RAIL_MODES } from '../src/editor/circuit/layout_core';
import {
  PLAN_LEGEND,
  PLAN_PALETTE_FALLBACK,
  PLAN_PALETTE_VARS,
} from '../src/editor/circuit/plan_core';
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

  it('keeps the bearing legend clear of the chips parked in the same corner', () => {
    // The legend is drawn on the CANVAS and `#viewChips` is a DOM overlay, so
    // nothing at runtime can discover the collision: they would simply be
    // painted on top of each other, and the key explaining the boxes is the one
    // thing on that canvas an operator reads instead of guessing.
    const chips = rules().find((rule) => rule.selector === '#viewChips');
    expect(chips, 'the sheet parks the view chips somewhere').toBeDefined();
    const bottom = /bottom:\s*(\d+)px/.exec(chips?.body ?? '');
    expect(bottom?.[1], 'the chips are parked a pixel amount off the bottom').toBeDefined();
    expect(chips?.body).toMatch(/left:\s*\d+px/);
    // A chip is about 20px tall at the page's own 11px type with its 2px
    // padding, so the legend's baseline has to clear the chips by more than
    // that. Asserted as a gap rather than as a magic number, since what matters
    // is that one does not paint over the other.
    expect(PLAN_LEGEND.bottomInset - Number(bottom?.[1])).toBeGreaterThanOrEqual(24);
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
    expect(assignments.length).toBe(29);
  });
});

describe('the circuit editor page wiring', () => {
  // `main.ts` is the one module of the page no unit test can construct (it is
  // the page), so the contracts between the action table, the boot order and
  // the gesture state are pinned the way this file pins everything else: by
  // reading the source. Each pin names the defect it holds shut.
  const mainSource = sources[files.findIndex((entry) => entry.file === 'main.ts')];

  it('has the walked corpus to scan', () => {
    expect(mainSource).toBeDefined();
    expect(mainSource).toContain('function runAction');
  });

  it('carries a runAction case for every rail mode the table advertises', () => {
    // The defect this pins: the Terrain rail grew a fifth digit in the table
    // and the keydown handler preventDefaulted it, but `runAction` had no
    // `modeTerrain` arm, so the shortcut was silently dead.
    for (const mode of RAIL_MODES) {
      expect(mainSource, `runAction has no case for ${MODE_ACTIONS[mode.id]}`).toContain(
        `case '${MODE_ACTIONS[mode.id]}':`,
      );
    }
  });

  it('captures the parked zoom before the blank canvas frames itself', () => {
    // Boot runs `newBlank()`, whose `fitView()` calls `rememberZoom()` and
    // overwrites `layout.zoom` with the blank-canvas fit scale, so a restore
    // that reads `layout.zoom` afterwards restores the clobbered value: the
    // operator's parked zoom was lost on every reload.
    const capture = mainSource.indexOf('const parkedZoom = layout.zoom');
    const boot = mainSource.lastIndexOf('newBlank();');
    expect(capture, 'boot captures layout.zoom before newBlank can clobber it').toBeGreaterThan(-1);
    expect(boot).toBeGreaterThan(-1);
    expect(capture).toBeLessThan(boot);
    expect(mainSource).toContain('view.scale = parkedZoom');
  });

  it('clamps the tool value where it changes, so the status says what a stroke paints', () => {
    // Typing 100 into the width box painted 40 (paintSpan clamps internally)
    // while the status line reported "set to 100": the box was only clamped on
    // a tool or tab SWAP, never on its own change event.
    const start = mainSource.indexOf('onToolValue');
    const end = mainSource.indexOf('onResume', start);
    expect(start).toBeGreaterThan(-1);
    const handler = mainSource.slice(start, end);
    expect(handler).toContain('clampToolValue');
    expect(handler).toContain('toolValueInput.value = String(');
  });

  it('scales the fence hit tolerance by the zoom, like every sibling gesture', () => {
    // `FENCE_POINT_TOLERANCE_YD` documents itself as "yards at zoom 1, the
    // caller scales it", and the caller returned it fixed while the handle,
    // segment and dressing tolerances all divide pixels by `view.scale`.
    expect(mainSource).toContain('FENCE_POINT_TOLERANCE_YD / view.scale');
  });

  it('feeds the refreshed hint and the PRESS frame through a dressing drag', () => {
    // Two silent flips out of one wiring. The hint was set ONCE at the press,
    // so a drag along the road longer than the projection window's reach fell
    // back to the whole-lap scan and authored the piece circuit-local twelve
    // yards off the road; and the frame was read off the entry the LAST move
    // committed, so one intermediate position past the envelope latched
    // 'absolute' for the rest of the drag. The move arm carries both: the hint
    // the core handed back, and the frame the piece wore at the press.
    expect(mainSource).toContain('movedProp(record, prop, point.x, point.z, dragHint, dragFrame)');
    expect(mainSource).toContain('dragHint = moved.hint;');
    // Both press arms that start a move drag capture the frame beside the hint.
    const captures = [...mainSource.matchAll(/dragFrame = propFrameOf\(/g)];
    expect(captures.length).toBeGreaterThanOrEqual(2);
  });

  it('reads a corner drag against the placement captured at the press', () => {
    // `placedFootprint` returns an explicit `collide` literal UNSCALED, so its
    // grip reach is CONSTANT while the scale grows: a ratio read against the
    // placement the previous move just committed multiplies the scale by
    // dist/reach on every pointermove and compounds to the clamp within a few
    // moves. The press captures the resolved piece; every move measures
    // against THAT.
    expect(mainSource).toContain('propGrab = placed;');
    expect(mainSource).toContain(
      'propWithHandleAt(prop, propGrab, propHandle, raw.x, raw.z, free)',
    );
    // And the fresh resolve is gone from the handle arm: nothing re-reads the
    // placement mid-drag.
    const arm = mainSource.slice(
      mainSource.indexOf("if (dressingDrag === 'prop'"),
      mainSource.indexOf("if (dressingDrag === 'road'"),
    );
    expect(arm).not.toContain('selectedPlacedProp()');
  });

  it('drops the stale point selection when a fence draw starts', () => {
    // Starting a draw reset `fenceSelection` and `groundPoint` but not
    // `fencePoint`, so a point index from the previous selection survived into
    // the freshly drawn fence and `del` removed one of ITS points.
    const draftStart = mainSource.indexOf('fenceDraft = { kit,');
    expect(draftStart).toBeGreaterThan(-1);
    const arm = mainSource.slice(draftStart, mainSource.indexOf('announceArmed', draftStart));
    expect(arm).toContain('fencePoint = null;');
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
