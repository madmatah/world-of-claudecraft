// What the prop library OFFERS: which categories the tiles fold into, and which
// of them a search leaves showing.
//
// The palette itself (`propPalette` in `props_core.ts`) says what the catalog
// holds and which keys belong to the circuit's theme; this says how that list is
// presented. They are separate because the first is about the GAME (a record may
// place any key, and the readout judges the placement rather than the vocabulary)
// and the second is about the hunt: dressing a circuit is mostly the search for
// the six pieces that look like this zone inside a catalog holding every zone's.
//
// Pure and DOM-free. Dev tool, so English lives here.

import type { PropPaletteEntry } from './props_core';

/**
 * The category that answers the operator's actual question.
 *
 * "Show me only the props for THIS race's theme." It is the theme record's own
 * `props` list, which is what `propPalette` flags as featured, and it is the
 * category the library opens on: a circuit is dressed from its zone's vocabulary
 * first and from the rest of the catalog only when nothing there fits.
 */
export const LIBRARY_THEME_CATEGORY = 'theme';

/** Everything the catalog holds, however far it is from this zone. */
export const LIBRARY_ALL_CATEGORY = 'all';

/** Where the library opens: the theme's own pieces. */
export const LIBRARY_DEFAULT_CATEGORY = LIBRARY_THEME_CATEGORY;

export interface LibraryCategory {
  id: string;
  /** What the chip says. The theme chip wears the THEME's id, because "theme" is
   *  a category name and `evergarden` is an answer. */
  label: string;
  count: number;
}

export interface LibraryFilter {
  category: string;
  /** Free text, matched against the catalog key and its group. */
  search: string;
}

const normalise = (text: string): string => text.trim().toLowerCase();

/**
 * The chips, in the order they are offered.
 *
 * Theme first and always, even at zero: a theme whose vocabulary is empty is
 * something the operator needs to SEE, and a chip that vanishes when it matters
 * most reads as the tool having no such feature. Groups follow in palette order
 * and only where they have something in them, and `all` closes the row.
 */
export function libraryCategories(
  entries: readonly PropPaletteEntry[],
  themeId: string,
): LibraryCategory[] {
  const themed = entries.filter((entry) => entry.featured).length;
  const out: LibraryCategory[] = [
    { id: LIBRARY_THEME_CATEGORY, label: themeId.trim() || LIBRARY_THEME_CATEGORY, count: themed },
  ];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.group)) continue;
    seen.add(entry.group);
    out.push({
      id: entry.group,
      label: entry.group,
      count: entries.filter((row) => row.group === entry.group).length,
    });
  }
  out.push({ id: LIBRARY_ALL_CATEGORY, label: LIBRARY_ALL_CATEGORY, count: entries.length });
  return out;
}

/** Whether a category id is one the chips actually offer. A stored choice
 *  outlives the theme it was made under, and a chip nothing matches would show
 *  an empty grid with no way back. */
export function libraryCategoryExists(categories: readonly LibraryCategory[], id: string): boolean {
  return categories.some((category) => category.id === id);
}

/**
 * What the grid shows.
 *
 * The SEARCH outranks the category, deliberately: typing "lantern" while the
 * theme chip is on means "find me the lantern", not "find me the lantern if this
 * zone happens to own one". A search that only ever narrowed the current chip
 * would answer nothing while looking like it worked.
 */
export function filterLibrary(
  entries: readonly PropPaletteEntry[],
  filter: LibraryFilter,
): PropPaletteEntry[] {
  const query = normalise(filter.search);
  if (query) {
    return entries.filter(
      (entry) => normalise(entry.asset).includes(query) || normalise(entry.group).includes(query),
    );
  }
  if (filter.category === LIBRARY_ALL_CATEGORY) return [...entries];
  if (filter.category === LIBRARY_THEME_CATEGORY) return entries.filter((entry) => entry.featured);
  return entries.filter((entry) => entry.group === filter.category);
}

/** The search box's own placeholder, which is also how the library says how much
 *  it is holding. */
export function librarySearchPlaceholder(count: number): string {
  return count === 1 ? 'search 1 asset' : `search ${count} assets`;
}

/** What the grid says when a filter matches nothing, naming the way out rather
 *  than leaving an empty box. */
export function libraryEmptyText(filter: LibraryFilter): string {
  if (filter.search.trim()) return `nothing matches "${filter.search.trim()}"`;
  if (filter.category === LIBRARY_THEME_CATEGORY) {
    return 'this theme names no pieces of its own: try another category';
  }
  return 'nothing in this category';
}
