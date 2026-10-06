// The dev server's draft endpoints: two GETs and the DELETE decision.
//
// They are the only path by which a file on disk becomes world geometry in a
// running game, so the id handling is the load-bearing part: the id names a
// FILE, and it arrives off a URL. Everything below drives the decision core the
// vite plugin is a thin fs adapter over, which is why a Vitest can reach it at
// all (`configureServer` runs only under the dev server).

import { describe, expect, it } from 'vitest';
import {
  DRAFT_ID_RE,
  type DraftFile,
  type DraftReader,
  draftDeleteDecision,
  draftListResponse,
  draftResponse,
} from '../src/editor/circuit/draft_endpoints_core';
import {
  circuitToTypeScript,
  draftFileContents,
  roundCircuit,
  validateCircuitPayload,
} from '../src/editor/circuit/export_core';
import { parseMortarOverdriveDraftCommand } from '../src/game/mortar_overdrive/draft_dev';
import {
  MORTAR_OVERDRIVE_PRACTICE_CIRCUIT as GARDEN,
  type MortarOverdriveCircuit,
} from '../src/sim/content/mortar_overdrive/circuits';

const record = (id = 'draft_one'): MortarOverdriveCircuit => ({ ...GARDEN, id });

/**
 * A reader that REMEMBERS what it was asked for, so a test can assert that a
 * refused id never reached the file system at all.
 *
 * Every file is stamped with a fixed mtime unless one is given, so the list's
 * ordering is a property of the values under test and never of when the suite
 * ran.
 */
function reader(
  files: Record<string, string>,
  mtimes: Record<string, number> = {},
): DraftReader & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    list: (): DraftFile[] =>
      Object.keys(files).map((name) => ({ name, mtimeMs: mtimes[name] ?? 1_000 })),
    read: (id) => {
      asked.push(id);
      return files[`${id}.ts`] ?? null;
    },
  };
}

describe('the draft list endpoint', () => {
  it('answers GET with the saved drafts and when each was written', () => {
    const response = draftListResponse(
      'GET',
      reader(
        { 'draft_b.ts': '', 'draft_a.ts': '', 'notes.md': '' },
        { 'draft_b.ts': 4_000, 'draft_a.ts': 9_000 },
      ),
    );
    expect(response.status).toBe(200);
    expect(response.contentType).toBe('application/json');
    // Newest first, which is what the list is FOR: the draft an operator is
    // reaching for is nearly always the one they were drawing last.
    expect(JSON.parse(response.body)).toEqual({
      drafts: [
        { id: 'draft_a', mtimeMs: 9_000 },
        { id: 'draft_b', mtimeMs: 4_000 },
      ],
    });
  });

  it('breaks a tie on the id, so two files written together still come back in one order', () => {
    const same = { 'draft_b.ts': '', 'draft_c.ts': '', 'draft_a.ts': '' };
    const ids = (
      JSON.parse(draftListResponse('GET', reader(same)).body) as {
        drafts: { id: string }[];
      }
    ).drafts.map((entry) => entry.id);
    expect(ids).toEqual(['draft_a', 'draft_b', 'draft_c']);
  });

  it('answers an empty draft directory with an empty list, not an error', () => {
    expect(JSON.parse(draftListResponse('GET', reader({})).body)).toEqual({ drafts: [] });
  });

  it('drops a file whose name is not an id, so nothing unaddressable is offered', () => {
    const response = draftListResponse('GET', reader({ 'Draft_One.ts': '', '..ts': '' }));
    expect(JSON.parse(response.body)).toEqual({ drafts: [] });
  });

  it('refuses every method but GET', () => {
    for (const method of ['POST', 'PUT', 'DELETE', undefined]) {
      expect(draftListResponse(method, reader({})).status).toBe(405);
    }
  });
});

describe('the one-draft endpoint', () => {
  const files = { 'draft_one.ts': draftFileContents(record()) };

  it('parses a saved draft back into the record the editor exported, field for field', () => {
    const response = draftResponse('GET', '/draft_one', reader(files));
    expect(response.status).toBe(200);
    expect(response.contentType).toBe('application/json');
    // The WHOLE record, not a handful of fields: a subset check is what let the
    // validator quietly drop the one authorable placement a circuit had, so the
    // raced draft lost the island out in its lake while the editor's own
    // preview still drew it. The authored DRESSING is that field now.
    const parsed = JSON.parse(response.body) as MortarOverdriveCircuit;
    expect(parsed).toEqual(roundCircuit(record()));
    expect(parsed.props).toEqual(GARDEN.props);
  });

  it('carries a circuit that authors no dressing without inventing any', () => {
    const plain = { ...record(), props: undefined };
    const response = draftResponse(
      'GET',
      '/draft_one',
      reader({ 'draft_one.ts': draftFileContents(plain) }),
    );
    const parsed = JSON.parse(response.body) as MortarOverdriveCircuit;
    expect(parsed).toEqual(roundCircuit(plain));
    expect('props' in parsed).toBe(false);
  });

  it('ignores a query string hung off the id', () => {
    expect(draftResponse('GET', '/draft_one?t=1', reader(files)).status).toBe(200);
  });

  it('refuses an id that could name a file outside the draft directory, without reading', () => {
    for (const url of [
      '/../../etc/passwd',
      '/..',
      '/../src/main.ts',
      '/draft_one/../../secret',
      '/%2e%2e%2fsecret',
      '/draft_one.ts',
      '/Draft_One',
      '/',
      undefined,
    ]) {
      const fs = reader(files);
      const response = draftResponse('GET', url, fs);
      expect(response.status, String(url)).toBe(400);
      expect(response.body).toBe('bad draft id');
      // The refusal happens BEFORE the read, which is what makes it a traversal
      // guard rather than a 404 that happened to be lucky.
      expect(fs.asked, String(url)).toEqual([]);
    }
  });

  it('answers an id nobody saved with a 404', () => {
    const response = draftResponse('GET', '/draft_missing', reader(files));
    expect(response.status).toBe(404);
  });

  it('refuses a scratch file that does not parse', () => {
    const response = draftResponse('GET', '/draft_one', reader({ 'draft_one.ts': 'not a record' }));
    expect(response.status).toBe(400);
    expect(response.body).toBe('draft does not parse');
  });

  it('refuses a file whose record carries a different id', () => {
    // A hand-renamed scratch file: the game would otherwise register a circuit
    // under a name nobody asked for.
    const response = draftResponse(
      'GET',
      '/draft_one',
      reader({ 'draft_one.ts': circuitToTypeScript(record('draft_other')) }),
    );
    expect(response.status).toBe(400);
    expect(response.body).toBe('draft id does not match its file');
  });

  it('refuses every method but GET, without reading', () => {
    for (const method of ['POST', 'PUT', 'DELETE', undefined]) {
      const fs = reader(files);
      expect(draftResponse(method, '/draft_one', fs).status).toBe(405);
      expect(fs.asked).toEqual([]);
    }
  });
});

describe('the draft delete decision', () => {
  const files = { 'draft_one.ts': draftFileContents(record()) };

  it('names the id the plugin may unlink, and nothing else', () => {
    const decision = draftDeleteDecision('DELETE', '/draft_one', reader(files));
    expect(decision.id).toBe('draft_one');
    expect(decision.response.status).toBe(200);
    expect(JSON.parse(decision.response.body)).toEqual({ deleted: 'draft_one' });
  });

  it('refuses every method but DELETE, without reading', () => {
    for (const method of ['GET', 'POST', 'PUT', undefined]) {
      const fs = reader(files);
      const decision = draftDeleteDecision(method, '/draft_one', fs);
      expect(decision.id, String(method)).toBeNull();
      expect(decision.response.status, String(method)).toBe(405);
      expect(fs.asked, String(method)).toEqual([]);
    }
  });

  it('refuses an id that could name a file outside the draft directory, without reading', () => {
    // The same traversal table the read arm is held to, because the two take the
    // id off the URL the same way and a delete is the arm where being wrong
    // costs a file rather than a response.
    for (const url of [
      '/../../etc/passwd',
      '/..',
      '/../src/main.ts',
      '/draft_one/../../secret',
      '/%2e%2e%2fsecret',
      '/draft_one.ts',
      '/Draft_One',
      '/',
      undefined,
    ]) {
      const fs = reader(files);
      const decision = draftDeleteDecision('DELETE', url, fs);
      expect(decision.id, String(url)).toBeNull();
      expect(decision.response.status, String(url)).toBe(400);
      expect(decision.response.body).toBe('bad draft id');
      expect(fs.asked, String(url)).toEqual([]);
    }
  });

  it('names no id for a draft nobody saved, so a stale row deletes nothing', () => {
    const decision = draftDeleteDecision('DELETE', '/draft_missing', reader(files));
    expect(decision.id).toBeNull();
    expect(decision.response.status).toBe(404);
  });

  it('never sets a content type on a refusal, so an error is not read as JSON', () => {
    for (const url of ['/..', '/draft_missing']) {
      expect(
        draftDeleteDecision('DELETE', url, reader(files)).response.contentType,
      ).toBeUndefined();
    }
  });
});

describe('the id shape', () => {
  it('matches what the save endpoint names its files with', () => {
    // Pinned against the literal rather than against the other regex object,
    // which would compare a thing to itself.
    expect(DRAFT_ID_RE.source).toBe('^[a-z][a-z0-9_]{2,40}$');
  });

  /**
   * The three copies of this rule, and the boundary table that keeps them
   * honest. They live apart on purpose (one validates the id INSIDE a payload,
   * one takes it off a URL, one parses a typed command) and they have to agree,
   * or an id the editor happily saves is one the game cannot ask for.
   */
  it.each([
    ['abc', true], //     the shortest legal id
    ['ab', false], //     one short
    ['draft_one', true],
    ['evergarden_practice', true],
    [`a${'b'.repeat(40)}`, true], //   41 characters, the longest legal
    [`a${'b'.repeat(41)}`, false], //  42, one over
    ['Draft_One', false], //           capitals
    ['1draft', false], //              a leading digit
    ['_draft', false], //              a leading underscore
    ['x-y', false], //                 a hyphen
    ['x.y', false], //                 the traversal alphabet
    ['x/y', false],
    ['..', false],
    ['', false],
  ])('agrees across all three copies of the id rule: %s', (id, legal) => {
    expect(DRAFT_ID_RE.test(id), `endpoint: ${id}`).toBe(legal);
    // The payload validator's own copy, reached the only way it is exposed.
    expect(validateCircuitPayload({ ...record(), id }) !== null, `payload: ${id}`).toBe(legal);
    // And the client's command parser, which refuses before it ever fetches.
    expect(
      parseMortarOverdriveDraftCommand(`/dev overdrivedraft ${id}`) !== null,
      `command: ${id}`,
    ).toBe(legal);
  });
});
