// What the dev server answers when something asks for a saved draft.
//
// The two endpoints exist so a running game can race a circuit that was drawn
// in the editor without a source edit (`/dev rallydraft`). They are READ ONLY,
// and this module is what makes that structural rather than a promise: it is
// handed a reader and has no writer at all, so no request routed through it can
// touch the tree.
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

/** The draft directory, as much of it as these endpoints may see. */
export interface DraftReader {
  /** File names in the draft directory; empty when it does not exist yet. */
  list(): readonly string[];
  /** One draft file's contents, or null when it is not there. */
  read(id: string): string | null;
}

const json = (body: unknown): DraftEndpointResponse => ({
  status: 200,
  body: JSON.stringify(body),
  contentType: 'application/json',
});

const refuse = (status: number, body: string): DraftEndpointResponse => ({ status, body });

/** Every draft the editor has saved, by id, sorted so the list is stable. */
export function draftListResponse(
  method: string | undefined,
  reader: DraftReader,
): DraftEndpointResponse {
  if (method !== 'GET') return refuse(405, 'GET only');
  const ids = reader
    .list()
    .filter((name) => name.endsWith('.ts'))
    .map((name) => name.slice(0, -3))
    .filter((id) => DRAFT_ID_RE.test(id))
    .sort();
  return json({ ids });
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
  const id = (url ?? '').replace(/^\//, '').split('?')[0];
  if (!DRAFT_ID_RE.test(id)) return refuse(400, 'bad draft id');
  const source = reader.read(id);
  if (source === null) return refuse(404, 'no such draft');
  const circuit = circuitFromTypeScript(source);
  if (!circuit) return refuse(400, 'draft does not parse');
  if (circuit.id !== id) return refuse(400, 'draft id does not match its file');
  return json(circuit);
}
