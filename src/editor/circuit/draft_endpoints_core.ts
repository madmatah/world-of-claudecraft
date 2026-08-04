// What the dev server answers when something asks for a saved draft.
//
// The read endpoints exist so a running game can race a circuit that was drawn
// in the editor without a source edit (`/dev rallydraft`), and the editor's own
// draft manager lists and discards them. This module is handed a READER and has
// no writer at all, which is what makes "a GET never writes" structural rather
// than a promise. The DELETE arm does not change that: it DECIDES, naming the id
// the plugin may unlink, and the plugin is the only thing here that can touch a
// file. A core that could delete would be a core a future GET could delete
// through.
//
// Everything here is a DECISION (is this method allowed, is this id an id, does
// this file parse), which is why it is a core and not inline in the plugin: the
// plugin lives in `vite.config.ts` behind `configureServer` and is unreachable
// from a test, and the id check is the one piece of it that must not be taken
// on trust.
//
// Pure core: DOM-free, deterministic, no fs, no network.

import { circuitFromTypeScript } from './export_core';

/**
 * Whether a string is a circuit id, which is what makes it safe to NAME A FILE
 * with. The same shape `export_core`'s validator enforces on the id INSIDE a
 * payload, restated here because these endpoints take an id off a URL instead:
 * no dot, no slash, no separator of any kind can pass, so no request can
 * resolve out of the draft directory however it is spelled.
 */
export const DRAFT_ID_RE = /^[a-z][a-z0-9_]{2,40}$/;

export interface DraftEndpointResponse {
  status: number;
  body: string;
  /** Set only on a success, so an error is never read as JSON. */
  contentType?: string;
}

/** One file in the draft directory, as much of it as these endpoints may see. */
export interface DraftFile {
  name: string;
  /** Last write, epoch ms. What makes a list of ids a list an operator can
   *  read: "which of these is the one I was drawing" is a question about time. */
  mtimeMs: number;
}

/** The draft directory, as much of it as these endpoints may see. */
export interface DraftReader {
  /** The draft directory's files; empty when it does not exist yet. */
  list(): readonly DraftFile[];
  /** One draft file's contents, or null when it is not there. */
  read(id: string): string | null;
}

/** One row of the draft list. */
export interface DraftListEntry {
  id: string;
  mtimeMs: number;
}

const json = (body: unknown): DraftEndpointResponse => ({
  status: 200,
  body: JSON.stringify(body),
  contentType: 'application/json',
});

const refuse = (status: number, body: string): DraftEndpointResponse => ({ status, body });

/**
 * Every draft the editor has saved, newest first.
 *
 * Newest first rather than alphabetical because of what the list is FOR: an
 * operator opening the draft manager is nearly always reaching for the circuit
 * they were drawing before lunch, and alphabetical order buries it among every
 * experiment they ever saved. The id breaks a tie, so two files written in the
 * same millisecond still come back in a stable order.
 */
export function draftListResponse(
  method: string | undefined,
  reader: DraftReader,
): DraftEndpointResponse {
  if (method !== 'GET') return refuse(405, 'GET only');
  const drafts: DraftListEntry[] = reader
    .list()
    .filter((file) => file.name.endsWith('.ts'))
    .map((file) => ({ id: file.name.slice(0, -3), mtimeMs: file.mtimeMs }))
    .filter((entry) => DRAFT_ID_RE.test(entry.id))
    .sort((a, b) => b.mtimeMs - a.mtimeMs || a.id.localeCompare(b.id));
  return json({ drafts });
}

/**
 * One draft, parsed back into a record.
 *
 * `url` is what the middleware mount leaves after its prefix, so "/<id>" plus
 * whatever query was hung off it. Parsed through the same core the save
 * endpoint writes with, so a hand-edited scratch file cannot hand the game a
 * record the editor itself would have refused; the id on the record has to
 * match the file it was read from, or the game would register a circuit under a
 * name nobody asked for.
 */
export function draftResponse(
  method: string | undefined,
  url: string | undefined,
  reader: DraftReader,
): DraftEndpointResponse {
  if (method !== 'GET') return refuse(405, 'GET only');
  const id = draftIdFromUrl(url);
  if (!id) return refuse(400, 'bad draft id');
  const source = reader.read(id);
  if (source === null) return refuse(404, 'no such draft');
  const circuit = circuitFromTypeScript(source);
  if (!circuit) return refuse(400, 'draft does not parse');
  if (circuit.id !== id) return refuse(400, 'draft id does not match its file');
  return json(circuit);
}

/** The id a mounted request carries, or null when it is not an id at all. The
 *  one place the URL is read, so the GET and the DELETE cannot end up checking
 *  it two different ways. */
function draftIdFromUrl(url: string | undefined): string | null {
  const id = (url ?? '').replace(/^\//, '').split('?')[0];
  return DRAFT_ID_RE.test(id) ? id : null;
}

/**
 * What the DELETE endpoint decided, and NOT what it did.
 *
 * `id` is the draft the caller is cleared to unlink, or null when the request
 * was refused and nothing may be touched. The split is the whole point of the
 * module: everything that can be got wrong (is this a method we answer, is this
 * an id, is there a file behind it) is decided here where a test can drive it,
 * and the only thing that can write is the fs adapter in `vite.config.ts`.
 */
export interface DraftDeleteDecision {
  id: string | null;
  response: DraftEndpointResponse;
}

/**
 * Whether a draft may be discarded.
 *
 * The id is checked against `DRAFT_ID_RE` BEFORE anything resolves a path with
 * it, exactly as the read arm does, so no spelling of `..` or `/` reaches the
 * caller: what comes back is either null or a name with no separator in it. The
 * 404 is deliberate rather than an idempotent 200: the draft manager's row is
 * built from a listing, so an id that is not there means the listing is stale
 * and the operator wants to know rather than watch a row vanish either way.
 */
export function draftDeleteDecision(
  method: string | undefined,
  url: string | undefined,
  reader: DraftReader,
): DraftDeleteDecision {
  if (method !== 'DELETE') return { id: null, response: refuse(405, 'DELETE only') };
  const id = draftIdFromUrl(url);
  if (!id) return { id: null, response: refuse(400, 'bad draft id') };
  if (reader.read(id) === null) return { id: null, response: refuse(404, 'no such draft') };
  return { id, response: json({ deleted: id }) };
}
