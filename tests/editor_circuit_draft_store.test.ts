// The autosaved draft, and the tile cache beside it.
//
// The draft is the one store in this tool that holds WORK rather than furniture,
// which raises the stakes on one point: a record from an older schema has to be
// refused rather than half-loaded into a page that then cannot draw it. Every
// case below is a way the blob can be wrong, because the only interesting
// behaviour of a parse-or-default is what it does with the ways.

import { describe, expect, it } from 'vitest';
import {
  DRAFT_SAVE_DEBOUNCE_MS,
  DRAFT_STORAGE_KEY,
  diskDraftRows,
  draftAgeText,
  parseDraft,
  parseThumbnailCache,
  resumeOfferText,
  serializeDraft,
  shouldWarnOnUnload,
  THUMBNAIL_STORAGE_KEY,
} from '../src/editor/circuit/draft_store_core';
import {
  REALM_RACERS_PRACTICE_CIRCUIT as GARDEN,
  type RealmRacersCircuit,
} from '../src/sim/content/realm_racers_circuits';

const record: RealmRacersCircuit = { ...GARDEN, id: 'draft_saved' };
const NOW = 1_700_000_000_000;

describe('the autosaved draft', () => {
  it('round-trips a drawn circuit through the same validator the endpoint runs', () => {
    // Through `validateCircuitPayload` rather than a second copy of the rules
    // here: a draft the page would accept that the save endpoint refuses is work
    // the operator cannot get out of the tool.
    const parsed = parseDraft(serializeDraft(record, true, NOW));
    expect(parsed?.drawn).toBe(true);
    expect(parsed?.savedAtMs).toBe(NOW);
    expect(parsed?.record.id).toBe('draft_saved');
    expect(parsed?.record.controlPoints).toEqual(record.controlPoints);
    expect(parsed?.record.widthBands).toEqual(record.widthBands);
  });

  it('offers nothing for a canvas nobody drew on', () => {
    // Not a corruption case, the COMMON one: someone opened the tool, looked,
    // and closed it. A blank canvas keeps a valid placeholder record underneath,
    // and resuming into that would show a circuit nobody drew.
    expect(parseDraft(serializeDraft(record, false, NOW))).toBeNull();
  });

  it('degrades to nothing on every shape it does not recognise', () => {
    expect(parseDraft(null)).toBeNull();
    expect(parseDraft('')).toBeNull();
    expect(parseDraft('not json at all')).toBeNull();
    expect(parseDraft('null')).toBeNull();
    expect(parseDraft('42')).toBeNull();
    expect(parseDraft('[1,2,3]')).toBeNull();
    expect(parseDraft(JSON.stringify({ record, drawn: true }))).toBeNull();
  });

  it('refuses a draft from a version nobody recognises', () => {
    // A versioned parse-or-default rather than a migration: what is stored is
    // one session's work in progress, and half-reading an older shape is worse
    // than offering nothing.
    const stored = JSON.parse(serializeDraft(record, true, NOW));
    expect(parseDraft(JSON.stringify({ ...stored, version: stored.version + 1 }))).toBeNull();
    expect(parseDraft(JSON.stringify({ ...stored, version: undefined }))).toBeNull();
  });

  it('refuses a record the validator will not have, per broken field', () => {
    const stored = JSON.parse(serializeDraft(record, true, NOW));
    const broken = (over: Record<string, unknown>): string =>
      JSON.stringify({ ...stored, record: { ...record, ...over } });
    // One dimension at a time, so a validator that stopped checking any single
    // one of them fails a case of its own.
    expect(parseDraft(broken({ controlPoints: [] }))).toBeNull();
    expect(parseDraft(broken({ widthBands: [] }))).toBeNull();
    expect(parseDraft(broken({ laps: 0 }))).toBeNull();
    expect(parseDraft(broken({ id: '' }))).toBeNull();
    expect(parseDraft(broken({ roles: [] }))).toBeNull();
    // ...and the untouched record still parses, so the cases above are not all
    // failing for some shared reason.
    expect(parseDraft(JSON.stringify(stored))).not.toBeNull();
  });

  it('survives a missing or nonsense timestamp rather than showing NaN ago', () => {
    const stored = JSON.parse(serializeDraft(record, true, NOW));
    expect(parseDraft(JSON.stringify({ ...stored, savedAtMs: undefined }))?.savedAtMs).toBe(0);
    expect(parseDraft(JSON.stringify({ ...stored, savedAtMs: 'soon' }))?.savedAtMs).toBe(0);
    expect(
      parseDraft(JSON.stringify({ ...stored, savedAtMs: Number.POSITIVE_INFINITY }))?.savedAtMs,
    ).toBe(0);
  });

  it('says how long ago in words the operator can act on', () => {
    expect(draftAgeText(NOW, NOW)).toBe('from a moment ago');
    expect(draftAgeText(NOW - 30_000, NOW)).toBe('from a moment ago');
    expect(draftAgeText(NOW - 5 * 60_000, NOW)).toBe('from 5 min ago');
    expect(draftAgeText(NOW - 59 * 60_000, NOW)).toBe('from 59 min ago');
    expect(draftAgeText(NOW - 60 * 60_000, NOW)).toBe('from an hour ago');
    expect(draftAgeText(NOW - 5 * 3600_000, NOW)).toBe('from 5 hours ago');
    // A draft with no usable stamp says so rather than claiming a time.
    expect(draftAgeText(0, NOW)).toBe('from an earlier session');
    // A clock that went backwards is not a draft from the future.
    expect(draftAgeText(NOW + 60_000, NOW)).toBe('from a moment ago');
  });

  it('names the circuit and the way to take it back', () => {
    const parsed = parseDraft(serializeDraft(record, true, NOW - 5 * 60_000));
    expect(parsed).not.toBeNull();
    if (!parsed) return;
    const text = resumeOfferText(parsed, NOW);
    expect(text).toContain('draft_saved');
    expect(text).toContain('from 5 min ago');
    expect(text).toContain('Resume');
  });

  it('interrupts a close only when there is drawn work with unsaved edits', () => {
    // All four, because it is an AND and either half alone reads plausible: a
    // guard on `dirty` alone asks about the blank canvas the tool opens on, and
    // one on `drawn` alone asks on every reload, which teaches the operator to
    // click through the one prompt that ever matters.
    expect(shouldWarnOnUnload(true, true)).toBe(true);
    expect(shouldWarnOnUnload(true, false)).toBe(false);
    expect(shouldWarnOnUnload(false, true)).toBe(false);
    expect(shouldWarnOnUnload(false, false)).toBe(false);
  });

  it('names its own key and a debounce long enough to survive a drag', () => {
    expect(DRAFT_STORAGE_KEY).toBe('woc_circuit_editor_draft');
    // A drag commits per pointermove; a synchronous storage write per move is a
    // stutter inside the one gesture that has to stay smooth.
    expect(DRAFT_SAVE_DEBOUNCE_MS).toBeGreaterThanOrEqual(500);
  });
});

describe('the drafts on disk, as the Load dialog lists them', () => {
  const payload = (drafts: unknown) => ({ drafts });

  it('turns the endpoint answer into rows an operator can read', () => {
    expect(
      diskDraftRows(
        payload([
          { id: 'draft_one', mtimeMs: NOW - 60_000 },
          { id: 'draft_two', mtimeMs: NOW - 7_200_000 },
        ]),
        NOW,
      ),
    ).toEqual([
      { id: 'draft_one', detail: 'from a moment ago' },
      { id: 'draft_two', detail: 'from 2 hours ago' },
    ]);
  });

  it('keeps the ENDPOINT order rather than re-sorting, so the row clicked is the row meant', () => {
    const rows = diskDraftRows(
      payload([
        { id: 'draft_zeta', mtimeMs: NOW },
        { id: 'draft_alpha', mtimeMs: NOW - 1_000_000 },
      ]),
      NOW,
    );
    expect(rows.map((row) => row.id)).toEqual(['draft_zeta', 'draft_alpha']);
  });

  it('drops an entry whose id could not name a file, before it reaches a URL', () => {
    const rows = diskDraftRows(
      payload([
        { id: '../secret', mtimeMs: NOW },
        { id: 'Draft_One', mtimeMs: NOW },
        { id: 42, mtimeMs: NOW },
        { id: 'draft_ok', mtimeMs: NOW },
      ]),
      NOW,
    );
    expect(rows.map((row) => row.id)).toEqual(['draft_ok']);
  });

  it('prints a real sentence for an entry with no usable timestamp', () => {
    // Rather than `NaN min ago` beside a perfectly good draft.
    const rows = diskDraftRows(
      payload([{ id: 'draft_one' }, { id: 'draft_two', mtimeMs: 'x' }]),
      NOW,
    );
    expect(rows).toEqual([
      { id: 'draft_one', detail: 'from an earlier session' },
      { id: 'draft_two', detail: 'from an earlier session' },
    ]);
  });

  it('comes back empty for every shape that is not a draft list', () => {
    for (const bad of [null, undefined, 42, 'drafts', [], {}, payload(null), payload('one')]) {
      expect(diskDraftRows(bad, NOW), JSON.stringify(bad) ?? 'undefined').toEqual([]);
    }
    expect(diskDraftRows(payload([null, 7, 'x']), NOW)).toEqual([]);
  });
});

describe('the tile cache', () => {
  it('round-trips the data URLs it was given', () => {
    const cache = parseThumbnailCache(
      JSON.stringify({ bench: 'data:image/webp;base64,AAA', oak: 'data:image/png;base64,BBB' }),
    );
    expect(cache).toEqual({
      bench: 'data:image/webp;base64,AAA',
      oak: 'data:image/png;base64,BBB',
    });
  });

  it('drops anything that is not an image URL, rather than handing it to an img', () => {
    // A store shared with the whole origin can hold anything; an `<img>` given a
    // `javascript:` src is the one thing here worth being strict about.
    const cache = parseThumbnailCache(
      JSON.stringify({
        good: 'data:image/webp;base64,AAA',
        script: 'javascript:alert(1)',
        remote: 'https://example.test/x.png',
        blob: 'blob:https://example.test/abc',
        number: 7,
        nested: { x: 1 },
        empty: '',
      }),
    );
    expect(Object.keys(cache)).toEqual(['good']);
  });

  it('degrades to an empty cache on every shape it does not recognise', () => {
    expect(parseThumbnailCache(null)).toEqual({});
    expect(parseThumbnailCache('')).toEqual({});
    expect(parseThumbnailCache('nonsense')).toEqual({});
    expect(parseThumbnailCache('null')).toEqual({});
    expect(parseThumbnailCache('[]')).toEqual({});
    expect(parseThumbnailCache('"a string"')).toEqual({});
  });

  it('salts the whole store with one version, not one per asset', () => {
    // A tile changes when the model changes, when the rig changes, or when the
    // framing changes, and only the last is visible from here. Bumping the key
    // throws the lot away and costs one render each.
    expect(THUMBNAIL_STORAGE_KEY).toBe('woc_circuit_editor_thumbs_v1');
    expect(THUMBNAIL_STORAGE_KEY).not.toBe(DRAFT_STORAGE_KEY);
  });
});
