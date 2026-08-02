// The dev server's two draft GETs.
//
// They are the only path by which a file on disk becomes world geometry in a
// running game, so the id handling is the load-bearing part: the id names a
// FILE, and it arrives off a URL. Everything below drives the decision core the
// vite plugin is a thin fs adapter over, which is why a Vitest can reach it at
// all (`configureServer` runs only under the dev server).

import { describe, expect, it } from 'vitest';
import {
  DRAFT_ID_RE,
  type DraftReader,
  draftListResponse,
  draftResponse,
} from '../src/editor/circuit/draft_endpoints_core';
import {
  circuitToTypeScript,
  draftFileContents,
  roundCircuit,
  validateCircuitPayload,
} from '../src/editor/circuit/export_core';
import { parseRealmRacersDraftCommand } from '../src/game/realm_racers_draft_dev';
import {
  REALM_RACERS_PRACTICE_CIRCUIT as GARDEN,
  type RealmRacersCircuit,
} from '../src/sim/content/realm_racers_circuits';

const record = (id = 'draft_one'): RealmRacersCircuit => ({ ...GARDEN, id });

/** A reader that REMEMBERS what it was asked for, so a test can assert that a
 *  refused id never reached the file system at all. */
function reader(files: Record<string, string>): DraftReader & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    list: () => Object.keys(files),
    read: (id) => {
      asked.push(id);
      return files[`${id}.ts`] ?? null;
    },
  };
}

describe('the draft list endpoint', () => {
  it('answers GET with the saved ids, sorted', () => {
    const response = draftListResponse(
      'GET',
      reader({ 'draft_b.ts': '', 'draft_a.ts': '', 'notes.md': '' }),
    );
    expect(response.status).toBe(200);
    expect(response.contentType).toBe('application/json');
    expect(JSON.parse(response.body)).toEqual({ ids: ['draft_a', 'draft_b'] });
  });

  it('answers an empty draft directory with an empty list, not an error', () => {
    expect(JSON.parse(draftListResponse('GET', reader({})).body)).toEqual({ ids: [] });
  });

  it('drops a file whose name is not an id, so nothing unaddressable is offered', () => {
    const response = draftListResponse('GET', reader({ 'Draft_One.ts': '', '..ts': '' }));
    expect(JSON.parse(response.body)).toEqual({ ids: [] });
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
    // validator quietly drop `landmark`, so the raced draft lost the island out
    // in its lake while the editor's own preview still drew it.
    const parsed = JSON.parse(response.body) as RealmRacersCircuit;
    expect(parsed).toEqual(roundCircuit(record()));
    expect(parsed.landmark).toEqual(GARDEN.landmark);
  });

  it('carries a circuit that authors no landmark without inventing one', () => {
    const plain = { ...record(), landmark: undefined };
    const response = draftResponse(
      'GET',
      '/draft_one',
      reader({ 'draft_one.ts': draftFileContents(plain) }),
    );
    const parsed = JSON.parse(response.body) as RealmRacersCircuit;
    expect(parsed).toEqual(roundCircuit(plain));
    expect('landmark' in parsed).toBe(false);
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
    expect(parseRealmRacersDraftCommand(`/dev rallydraft ${id}`) !== null, `command: ${id}`).toBe(
      legal,
    );
  });
});
