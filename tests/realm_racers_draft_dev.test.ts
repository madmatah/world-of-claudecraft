// `/dev rallydraft`: the client half of the draft loop.
//
// It lives in the game layer because the sim never fetches, so what this pins
// is the ORDER and the refusals: read the draft, validate it with the editor's
// own validator, register it, draw it, and only then race it. Every one of
// those can fail, and a dev tool whose failure is silence costs more than a
// slow loop does.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { draftResponse } from '../src/editor/circuit/draft_endpoints_core';
import { circuitToTypeScript } from '../src/editor/circuit/export_core';
import {
  fetchRealmRacersDraft,
  parseRealmRacersDraftCommand,
  type RealmRacersDraftDevDeps,
  runRealmRacersDraftCommand,
} from '../src/game/realm_racers_draft_dev';
import {
  REALM_RACERS_PRACTICE_CIRCUIT as GARDEN,
  type RealmRacersCircuit,
} from '../src/sim/content/realm_racers_circuits';

const draftRecord = (id = 'draft_one'): RealmRacersCircuit => ({
  ...GARDEN,
  id,
  roles: ['competition'],
  practiceCopies: 0,
});

/** What the endpoint actually returns: the record as JSON. */
const draftPayload = (id = 'draft_one'): unknown => JSON.parse(JSON.stringify(draftRecord(id)));

function deps(over: Partial<RealmRacersDraftDevDeps> = {}) {
  const logs: string[] = [];
  const raced: string[] = [];
  const drawn: string[] = [];
  // The RECORDS handed on, not just their ids: what the sim registers and what
  // the renderer draws have to be the record that came off the wire, or the two
  // halves of the loop are looking at different circuits.
  const registered: RealmRacersCircuit[] = [];
  const drawnRecords: RealmRacersCircuit[] = [];
  const bag: RealmRacersDevTestBag = {
    logs,
    raced,
    drawn,
    registered,
    drawnRecords,
    deps: {
      fetchDraft: async () => draftPayload(),
      register: (circuit) => {
        registered.push(circuit);
        return { lane: 7, problems: [] };
      },
      draw: (circuit) => {
        drawn.push(circuit.id);
        drawnRecords.push(circuit);
      },
      race: (command) => {
        raced.push(command);
      },
      log: (text) => {
        logs.push(text);
      },
      ...over,
    },
  };
  return bag;
}

interface RealmRacersDevTestBag {
  logs: string[];
  raced: string[];
  drawn: string[];
  registered: RealmRacersCircuit[];
  drawnRecords: RealmRacersCircuit[];
  deps: RealmRacersDraftDevDeps;
}

describe('parsing the command', () => {
  it('takes both spellings and defaults the tier to ace', () => {
    expect(parseRealmRacersDraftCommand('/dev rallydraft draft_one')).toEqual({
      id: 'draft_one',
      tier: 'ace',
    });
    expect(parseRealmRacersDraftCommand('/devrallydraft draft_one')).toEqual({
      id: 'draft_one',
      tier: 'ace',
    });
  });

  it('takes a named tier and ignores one the game does not have', () => {
    expect(parseRealmRacersDraftCommand('/dev rallydraft draft_one rookie')?.tier).toBe('rookie');
    expect(parseRealmRacersDraftCommand('/dev rallydraft draft_one DRIVER')?.tier).toBe('driver');
    expect(parseRealmRacersDraftCommand('/dev rallydraft draft_one legend')?.tier).toBe('ace');
  });

  it('refuses an id that is not one, so nothing reaches the endpoint', () => {
    // The traversal shapes above all: the parser is the first of the two
    // checks (the endpoint runs the same regex on its own side).
    for (const id of ['../secret', 'a', 'Draft_One', 'draft/one', '..', 'draft.one', '1draft']) {
      expect(parseRealmRacersDraftCommand(`/dev rallydraft ${id}`), id).toBeNull();
    }
  });

  it('is not any other command', () => {
    expect(parseRealmRacersDraftCommand('/dev rally evergarden_practice')).toBeNull();
    expect(parseRealmRacersDraftCommand('/dev rallydraft')).toBeNull();
    expect(parseRealmRacersDraftCommand('hello')).toBeNull();
  });
});

describe('running the command', () => {
  it('reads, registers, draws, then races, in that order', async () => {
    const order: string[] = [];
    const bag = deps({
      fetchDraft: async () => {
        order.push('fetch');
        return draftPayload();
      },
      register: () => {
        order.push('register');
        return { lane: 7, problems: [] };
      },
      draw: () => {
        order.push('draw');
      },
      race: () => {
        order.push('race');
      },
    });
    const ok = await runRealmRacersDraftCommand({ id: 'draft_one', tier: 'ace' }, bag.deps);
    expect(ok).toBe(true);
    expect(order).toEqual(['fetch', 'register', 'draw', 'race']);
  });

  it('races through the sim command that already knows how to seat a grid', async () => {
    const bag = deps();
    await runRealmRacersDraftCommand({ id: 'draft_one', tier: 'rookie' }, bag.deps);
    expect(bag.raced).toEqual(['/dev rally draft_one rookie']);
    expect(bag.drawn).toEqual(['draft_one']);
    expect(bag.logs.join(' ')).toContain('lane 7');
  });

  it('hands the sim and the renderer the record it fetched, field for field', () => {
    // The whole record, not its id: a field lost between the endpoint and the
    // sim is a circuit that drives differently from the one the editor drew,
    // and the authored dressing is exactly that kind of field.
    const payload = draftPayload();
    return runRealmRacersDraftCommand(
      { id: 'draft_one', tier: 'ace' },
      {
        ...deps().deps,
        fetchDraft: async () => payload,
        register: (circuit) => {
          expect(circuit).toEqual(payload);
          expect(circuit.props).toEqual(GARDEN.props);
          return { lane: 7, problems: [] };
        },
        draw: (circuit) => {
          expect(circuit).toEqual(payload);
        },
      },
    ).then((ok) => {
      expect(ok).toBe(true);
    });
  });

  it('registers and draws the SAME record object, so the two never diverge', async () => {
    const bag = deps();
    await runRealmRacersDraftCommand({ id: 'draft_one', tier: 'ace' }, bag.deps);
    expect(bag.registered).toHaveLength(1);
    expect(bag.drawnRecords[0]).toBe(bag.registered[0]);
    expect(bag.registered[0]).toEqual(draftPayload());
  });

  it('round-trips a draft file the save endpoint would have written', async () => {
    // The real payload path: the endpoint parses the scratch file back with
    // `circuitFromTypeScript`, so what the client validates is what the editor
    // exported.
    const source = circuitToTypeScript(draftRecord());
    const bag = deps({ fetchDraft: async () => JSON.parse(JSON.stringify(parseSource(source))) });
    expect(await runRealmRacersDraftCommand({ id: 'draft_one', tier: 'ace' }, bag.deps)).toBe(true);
  });

  it('refuses a payload that is not a circuit record, without racing', async () => {
    const bag = deps({ fetchDraft: async () => ({ id: 'draft_one', controlPoints: 'nope' }) });
    expect(await runRealmRacersDraftCommand({ id: 'draft_one', tier: 'ace' }, bag.deps)).toBe(
      false,
    );
    expect(bag.raced).toEqual([]);
    expect(bag.drawn).toEqual([]);
    expect(bag.logs.join(' ')).toContain('not a circuit record');
  });

  it('refuses a record whose id is not the one that was asked for', async () => {
    const bag = deps({ fetchDraft: async () => draftPayload('draft_other') });
    expect(await runRealmRacersDraftCommand({ id: 'draft_one', tier: 'ace' }, bag.deps)).toBe(
      false,
    );
    expect(bag.raced).toEqual([]);
    expect(bag.logs.join(' ')).toContain('draft_other');
  });

  it('reports the sim refusal by name and never races', async () => {
    const bag = deps({
      register: () => ({ lane: -1, problems: ['self_crossing: 0.4 against 355.0'] }),
    });
    expect(await runRealmRacersDraftCommand({ id: 'draft_one', tier: 'ace' }, bag.deps)).toBe(
      false,
    );
    expect(bag.drawn).toEqual([]);
    expect(bag.raced).toEqual([]);
    expect(bag.logs.join(' ')).toContain('self_crossing');
  });

  it('reports a dead endpoint instead of failing silently', async () => {
    const bag = deps({
      fetchDraft: async () => {
        throw new Error('404 no such draft');
      },
    });
    expect(await runRealmRacersDraftCommand({ id: 'draft_one', tier: 'ace' }, bag.deps)).toBe(
      false,
    );
    expect(bag.logs.join(' ')).toContain('no such draft');
    expect(bag.raced).toEqual([]);
  });
});

describe('the default reader', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('asks the dev-server endpoint for the id it was given', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => draftPayload(),
      text: async () => '',
    }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchRealmRacersDraft('draft_one')).toEqual(draftPayload());
    expect(fetchMock).toHaveBeenCalledWith('/__circuit_editor/draft/draft_one');
  });

  it('throws the endpoint own words on a refusal, so the readout can name it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, text: async () => 'no such draft' })),
    );
    await expect(fetchRealmRacersDraft('draft_one')).rejects.toThrow('no such draft');
  });
});

/** The endpoint's own answer for a saved draft file, so the round-trip case
 *  exercises the real reader rather than a hand-built object. */
function parseSource(source: string): unknown {
  const response = draftResponse('GET', '/draft_one', {
    list: () => [{ name: 'draft_one.ts', mtimeMs: 0 }],
    read: () => source,
  });
  return JSON.parse(response.body);
}
