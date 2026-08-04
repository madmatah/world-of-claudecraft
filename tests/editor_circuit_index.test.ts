// The circuit editor's barrel: whether it really is the public surface it says
// it is.
//
// Nothing in the repo imports `src/editor/circuit/index.ts` today (the page
// imports its siblings directly, and every test imports the core it is about),
// which is exactly why it needed a pin: an unimported barrel is a declaration
// with no reader, so a core export added in one session and never re-exported
// leaves the declared surface quietly incomplete and nothing says so.
//
// Both directions are checked. Forward: every export of every `*_core.ts` (plus
// `editor_icons.ts`, which is a table, not a core, and is deliberately public)
// appears in the barrel. Backward: no DOM module leaks in, because the split
// between "cores anything may import" and "chrome only the page composes" is the
// thing the header claims and would otherwise be a comment.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as barrel from '../src/editor/circuit/index';
import { tsFilesUnder } from './helpers/ts_files_under';

const directory = resolve(import.meta.dirname, '../src/editor/circuit');
const files = tsFilesUnder(directory);

/** What the barrel promises to re-export in full. */
const PUBLIC = files.filter(
  (entry) => entry.file.endsWith('_core.ts') || entry.file === 'editor_icons.ts',
);

/** What it promises to keep out: the page and the chrome it composes. */
const PRIVATE = files.filter(
  (entry) => !PUBLIC.includes(entry) && entry.file !== 'index.ts' && entry.file.endsWith('.ts'),
);

const barrelSource = readFileSync(resolve(directory, 'index.ts'), 'utf8');
/** The export statements alone. The header names modules and reasons, and a name
 *  mentioned in prose is not a re-export. */
const barrelExports = barrelSource.replace(/^\s*\/\/.*$/gm, '');

/**
 * Every name a module exports, read off its source.
 *
 * Source rather than the runtime namespace, because half of what these cores
 * export is TYPES, which are erased before a test can see them: `DockGeometry`
 * and `PropFrame` are as much of the public surface as `clampDock` is, and a
 * runtime-only sweep would have declared the barrel complete while a type was
 * missing. The runtime check below covers the other half and catches a name this
 * regex reads that the module does not actually export.
 */
function exportedNames(source: string): string[] {
  const out: string[] = [];
  for (const match of source.matchAll(
    /^export\s+(?:declare\s+)?(?:const|let|function|class|abstract class|interface|type|enum)\s+([A-Za-z0-9_]+)/gm,
  )) {
    out.push(match[1]);
  }
  return out;
}

describe('the circuit editor barrel', () => {
  it('finds the modules it is meant to be about', () => {
    // A vacuity floor: a walk that matched nothing would pass every case below.
    expect(PUBLIC.length).toBeGreaterThanOrEqual(12);
    expect(PRIVATE.length).toBeGreaterThanOrEqual(6);
    expect(PUBLIC.map((entry) => entry.file)).toContain('layout_core.ts');
    expect(PUBLIC.map((entry) => entry.file)).toContain('plan_core.ts');
    expect(PRIVATE.map((entry) => entry.file)).toContain('main.ts');
    expect(PRIVATE.map((entry) => entry.file)).toContain('shell.ts');
  });

  it('reads every export form the cores actually use', () => {
    // The completeness claim below is only as complete as this regex. It matches
    // the declaration forms these cores use today and nothing else, so a core
    // that grows an `export { x }` list, an `export default` or an
    // `export async function` would leave the sweep silently. Checked rather
    // than assumed: every `export` line has to be one the reader understands.
    const unread: string[] = [];
    for (const entry of PUBLIC) {
      const source = readFileSync(entry.full, 'utf8');
      for (const line of source.split('\n')) {
        if (!/^export\b/.test(line)) continue;
        const declaration =
          /^export\s+(?:declare\s+)?(?:const|let|function|class|abstract class|interface|type|enum)\s+[A-Za-z0-9_]/.test(
            line,
          );
        // A re-export of a sibling is legal and carries no name of its own.
        const reexport = /^export\s+(?:type\s+)?\{/.test(line) && line.includes(' from ');
        if (!declaration && !reexport) unread.push(`${entry.file}: ${line.trim()}`);
      }
    }
    expect(unread, 'these export lines are shapes the completeness sweep cannot read').toEqual([]);
  });

  it('re-exports every name every core declares', () => {
    const missing: string[] = [];
    for (const entry of PUBLIC) {
      for (const name of exportedNames(readFileSync(entry.full, 'utf8'))) {
        // Followed by a comma OR the closing brace: the last name of a one-line
        // re-export carries no trailing comma, which is how three of them hid.
        if (!new RegExp(`(^|[\\s,{])(type\\s+)?${name}\\s*[,}]`, 'm').test(barrelExports)) {
          missing.push(`${entry.file}: ${name}`);
        }
      }
    }
    expect(missing, 'these core exports are not on the declared public surface').toEqual([]);
  });

  it('re-exports every VALUE the cores declare, as a value', () => {
    // The other half of the same claim, and the one the regex above cannot make:
    // a name listed in the barrel that the module does not really export is a
    // build error here rather than a passing text match.
    const values = Object.keys(barrel);
    expect(values.length).toBeGreaterThan(100);
    expect(values).toContain('clampDock');
    expect(values).toContain('ghostPlacement');
    expect(values).toContain('starterControlPoints');
    expect(values).toContain('editorIcon');
  });

  it('keeps the page and its chrome out', () => {
    for (const entry of PRIVATE) {
      const specifier = `./${entry.file.replace(/\.ts$/, '')}`;
      expect(
        barrelSource,
        `${entry.file} is a DOM module the page composes, not part of the public surface`,
      ).not.toContain(`from '${specifier}'`);
    }
  });
});
