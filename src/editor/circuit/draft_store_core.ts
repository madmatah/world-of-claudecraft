// What the tool remembers about the DOCUMENT between sessions, and what it
// remembers about how each catalog piece looks.
//
// Two stores, one file, because they are the same decision twice: a versioned
// blob in `localStorage` that must degrade to nothing rather than break the page
// open. The layout store (`layout_core.ts`) already works this way; this is the
// half that holds work rather than furniture, which raises the stakes on exactly
// one point: a draft is validated through `validateCircuitPayload`, the SAME
// check the save endpoint runs, so a record from an older schema is refused
// rather than half-loaded into a page that then cannot draw it.
//
// Resuming is an OFFER, never an action. A dev tool that silently reopened
// yesterday's draft over a blank canvas would be deciding what the operator came
// here to do; the status bar says there is one and the operator takes it or
// draws over it.
//
// Pure and DOM-free: the page hands in the raw string and the clock.

import type { RealmRacersCircuit } from '../../sim/content/realm_racers_circuits';
import { DRAFT_ID_RE } from './draft_endpoints_core';
import { validateCircuitPayload } from './export_core';

export const DRAFT_STORAGE_KEY = 'woc_circuit_editor_draft';
const DRAFT_VERSION = 1;

/** How long a commit burst is allowed to run before the draft is written, ms.
 *  A drag commits per pointermove, and a synchronous storage write per move is a
 *  stutter inside the one gesture that has to stay smooth. */
export const DRAFT_SAVE_DEBOUNCE_MS = 1000;

export interface StoredDraft {
  record: RealmRacersCircuit;
  /** Whether the operator had drawn anything, which is the one piece of page
   *  state a record cannot carry: a blank canvas keeps a valid placeholder
   *  underneath, and resuming into it would show a circuit nobody drew. */
  drawn: boolean;
  savedAtMs: number;
}

export function serializeDraft(record: RealmRacersCircuit, drawn: boolean, nowMs: number): string {
  return JSON.stringify({ version: DRAFT_VERSION, record, drawn, savedAtMs: nowMs });
}

/**
 * The stored draft, or null.
 *
 * Null on every failure and never a throw: an unparseable blob, a version
 * nobody recognises, a record the validator refuses, or a draft that was saved
 * blank. The last one is not a corruption case, it is the common one: an
 * operator who opened the tool, looked, and closed it has nothing worth
 * offering back.
 */
export function parseDraft(raw: string | null): StoredDraft | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const held = parsed as Record<string, unknown>;
  if (held.version !== DRAFT_VERSION) return null;
  if (held.drawn !== true) return null;
  const record = validateCircuitPayload(held.record);
  if (!record) return null;
  const savedAtMs =
    typeof held.savedAtMs === 'number' && Number.isFinite(held.savedAtMs) ? held.savedAtMs : 0;
  return { record, drawn: true, savedAtMs };
}

/** How long ago, in the operator's own words. Minutes and hours only: a draft is
 *  either from this sitting or from another one, and nothing finer changes what
 *  they do about it. */
export function draftAgeText(savedAtMs: number, nowMs: number): string {
  const seconds = Math.max(0, Math.round((nowMs - savedAtMs) / 1000));
  if (savedAtMs <= 0) return 'from an earlier session';
  if (seconds < 90) return 'from a moment ago';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `from ${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours === 1 ? 'from an hour ago' : `from ${hours} hours ago`;
}

/**
 * Whether closing the tab is worth interrupting.
 *
 * Only while there is a DRAWN circuit with unsaved edits. A dev tool that asked
 * on every reload would teach the operator to click through the one prompt that
 * ever matters, and a blank canvas has nothing to lose: the draft is already in
 * storage by the time this is asked, so the prompt is about the operator who
 * meant to press Save draft, not about the data.
 */
export function shouldWarnOnUnload(dirty: boolean, drawn: boolean): boolean {
  return dirty && drawn;
}

/** The line the status bar carries at boot when there is work to come back to. */
export function resumeOfferText(draft: StoredDraft, nowMs: number): string {
  return `${draft.record.id} ${draftAgeText(draft.savedAtMs, nowMs)} is still here: press Resume to take it back`;
}

// ---- the drafts on disk ----

/** One row of the Load dialog's draft list. */
export interface DiskDraftRow {
  id: string;
  /** How long ago it was written, in the same words the resume offer uses. */
  detail: string;
}

/**
 * The draft list, as the Load dialog shows it.
 *
 * The payload comes off a dev endpoint on the same origin, so this is not a
 * trust boundary; what it IS is a shape that can go stale, because the endpoint
 * and the page are edited on different days. Every row is checked rather than
 * cast: an id that is not an id would end up in a URL the next click builds, and
 * a missing timestamp would print `NaN min ago` beside a perfectly good draft.
 *
 * The order is the ENDPOINT's (newest first) and is not re-sorted here: two
 * orderings of one list is how the row an operator clicked stops being the row
 * they meant.
 */
export function diskDraftRows(payload: unknown, nowMs: number): DiskDraftRow[] {
  if (!payload || typeof payload !== 'object') return [];
  const drafts = (payload as { drafts?: unknown }).drafts;
  if (!Array.isArray(drafts)) return [];
  const out: DiskDraftRow[] = [];
  for (const entry of drafts) {
    if (!entry || typeof entry !== 'object') continue;
    const { id, mtimeMs } = entry as { id?: unknown; mtimeMs?: unknown };
    if (typeof id !== 'string' || !DRAFT_ID_RE.test(id)) continue;
    const written = typeof mtimeMs === 'number' && Number.isFinite(mtimeMs) ? mtimeMs : 0;
    out.push({ id, detail: draftAgeText(written, nowMs) });
  }
  return out;
}

// ---- the thumbnail cache ----

/**
 * One version salt for the WHOLE tile store.
 *
 * Per-asset versioning would be a promise this tool cannot keep: a tile changes
 * when the MODEL changes, when the rig changes, or when the framing changes, and
 * only the last of those is visible from here. Bumping the key throws the lot
 * away and costs one render each, which is a second on a dev page.
 */
export const THUMBNAIL_STORAGE_KEY = 'woc_circuit_editor_thumbs_v1';

/** What the tile store holds: a data URL per catalog key. Anything that is not
 *  a string is dropped rather than handed to an `<img>`. */
export function parseThumbnailCache(raw: string | null): Record<string, string> {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const out: Record<string, string> = {};
  for (const [asset, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value === 'string' && value.startsWith('data:image/')) out[asset] = value;
  }
  return out;
}
