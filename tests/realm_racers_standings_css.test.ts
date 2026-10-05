// @vitest-environment jsdom
//
// The CSS half of the Realm Racers standings panel, which is the half the fix
// for the truncated-name bug actually lives in.
//
// The bug: every rival row of every practice race showed an ellipsis instead of
// a name, because the row spent its width on a class crest that says nothing in
// a racing minigame. The fix removed the crest CELL from the painter and the
// crest COLUMN from both stylesheets, and widened the desktop panel. Nothing
// tied those two sides together, so a row that grows a fourth cell against a
// stale three-track template would push the lap into the wrong track and squeeze
// the name back behind an ellipsis with every DOM test still green.
//
// This guard is the tie: it builds a row through the REAL painter and asserts
// the track count in each sheet equals the cells that row actually mints. It
// follows the tests/fct_mobile_css.test.ts idiom (read the CSS, flat-parse it)
// for the stylesheet half, and drives the real module for the DOM half.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeWriterFacet } from '../src/ui/painter_host';
import { RealmRacersStandingsPanel } from '../src/ui/realm_racers_standings_painter';
import type { RealmRacersStandingsView } from '../src/ui/realm_racers_standings_view';

// Resolved from the vitest project root, NOT `import.meta.url`: this suite runs
// under jsdom (the painter needs a real DOM), and there `import.meta.url` is not
// a file URL, so `fileURLToPath` throws at module load. The node-env CSS guards
// use the URL form; this one cannot.
const readSheet = (name: string): string =>
  readFileSync(resolve(process.cwd(), 'src/styles', name), 'utf8');
const COMPONENTS_CSS = readSheet('components.css');
const HUD_MOBILE_CSS = readSheet('hud.mobile.css');

/**
 * The `grid-template-columns` value of the first rule whose selector text ends
 * in `.rally-standing`, as its list of tracks. Flat-parsed rather than run
 * through a CSS engine: jsdom does no layout, so the declaration text IS the
 * contract here. `minmax(0, 1fr)` holds a comma, so tracks are split on
 * top-level whitespace with parenthesis depth tracked.
 */
function rowTracks(css: string): string[] {
  const rule = /\.rally-standing\s*\{([^}]*)\}/.exec(css);
  if (!rule) throw new Error('no .rally-standing rule found');
  const decl = /grid-template-columns:\s*([^;]+);/.exec(rule[1]);
  if (!decl) throw new Error('.rally-standing declares no grid-template-columns');
  const tracks: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of decl[1].trim()) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (/\s/.test(ch) && depth === 0) {
      if (current) tracks.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current) tracks.push(current);
  return tracks;
}

/** One painted row's own element children, built through the real painter. */
function paintedRowCells(): number {
  const noop = (): void => {};
  const layer = document.createElement('div');
  const panel = new RealmRacersStandingsPanel({
    layer: () => layer,
    writers: makeWriterFacet(new Map(), new Map(), new Map(), new Map(), noop, noop),
  });
  const view: RealmRacersStandingsView = {
    active: true,
    totalLaps: 3,
    sig: 'one-row',
    rows: [
      {
        pid: 1,
        placing: 1,
        name: 'Bryn Kettlespoke',
        lap: 1,
        isMe: false,
        finished: false,
        retired: false,
        bot: true,
      },
    ],
  };
  panel.update(view);
  const row = layer.querySelector('.rally-standing') as HTMLElement;
  expect(row).not.toBeNull();
  return row.children.length;
}

describe('Realm Racers standings panel CSS', () => {
  it('gives each sheet exactly as many grid tracks as the painter mints cells', () => {
    // The coupling the fix depends on, asserted in both directions rather than
    // as two independent literals: a cell added or removed on either side
    // without the other reds here.
    const cells = paintedRowCells();
    expect(cells).toBe(3);
    expect(rowTracks(COMPONENTS_CSS)).toHaveLength(cells);
    expect(rowTracks(HUD_MOBILE_CSS)).toHaveLength(cells);
  });

  it('leaves the name the only track allowed to take the slack', () => {
    // The placing and the lap are fixed and intrinsic; the NAME is the one
    // flexible track. That ordering is what makes the name (not the lap, and
    // not the Bot tag) absorb a narrow panel, and it is why a crest column was
    // never free: every px it took came out of this track.
    for (const css of [COMPONENTS_CSS, HUD_MOBILE_CSS]) {
      const tracks = rowTracks(css);
      expect(tracks[0]).toMatch(/^\d+px$/);
      expect(tracks[1]).toBe('minmax(0, 1fr)');
      expect(tracks[2]).toBe('auto');
    }
  });

  it('keeps the desktop panel wide enough for the longest house-pilot name', () => {
    // The width the truncation fix bought. Pinned as a literal because it is a
    // measured value (see the rule's own comment and the name-length bound in
    // tests/realm_racers_bots.test.ts), so narrowing it is a decision someone
    // has to make here rather than a silent regression of the reported bug.
    const panel = /#realm-racers-standings\s*\{([^}]*)\}/.exec(COMPONENTS_CSS);
    expect(panel).not.toBeNull();
    expect(/width:\s*240px;/.test((panel as RegExpExecArray)[1])).toBe(true);
    // And it still clamps symmetrically against its own 12px inset, so the
    // wider panel cannot overflow a narrow viewport (the app viewport, which
    // the desktop shell and the native shells size, not the bare one).
    expect(
      /max-width:\s*calc\(var\(--app-vw, 100vw\) - 24px\);/.test((panel as RegExpExecArray)[1]),
    ).toBe(true);
    expect(/left:\s*12px;/.test((panel as RegExpExecArray)[1])).toBe(true);
  });
});
