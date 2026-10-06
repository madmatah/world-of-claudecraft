// What the prop library OFFERS: the categories the tiles fold into and what a
// search leaves showing.
//
// The operator's own ask is the first case here: a category listing ONLY the
// props of this race's theme. Everything else in the file exists to keep that
// one honest, because a theme chip that quietly falls back to the whole catalog
// looks exactly like a theme chip that works.

import { describe, expect, it } from 'vitest';
import {
  filterLibrary,
  LIBRARY_ALL_CATEGORY,
  LIBRARY_DEFAULT_CATEGORY,
  LIBRARY_THEME_CATEGORY,
  libraryCategories,
  libraryCategoryExists,
  libraryEmptyText,
  librarySearchPlaceholder,
} from '../src/editor/circuit/library_core';
import { propPalette } from '../src/editor/circuit/props_core';
import { MORTAR_OVERDRIVE_PROPS } from '../src/sim/content/mortar_overdrive/props';

/** The garden's own vocabulary, a real theme's list rather than a made-up one:
 *  the category is only worth anything if it matches what a theme really holds. */
const GARDEN = ['oak', 'bench', 'postLantern', 'fountain'] as const;
const entries = () => propPalette(MORTAR_OVERDRIVE_PROPS, GARDEN);

describe('the library categories', () => {
  it('opens on the theme, and the theme chip wears the theme id', () => {
    // "theme" is a category NAME; `evergarden` is an answer. The chip says the
    // second one because the operator is asking about this circuit.
    const categories = libraryCategories(entries(), 'evergarden');
    expect(LIBRARY_DEFAULT_CATEGORY).toBe(LIBRARY_THEME_CATEGORY);
    expect(categories[0].id).toBe(LIBRARY_THEME_CATEGORY);
    expect(categories[0].label).toBe('evergarden');
    expect(categories[0].count).toBe(GARDEN.length);
    expect(categories[categories.length - 1].id).toBe(LIBRARY_ALL_CATEGORY);
    expect(categories[categories.length - 1].count).toBe(entries().length);
  });

  it('counts each group once, and lists no group twice', () => {
    const categories = libraryCategories(entries(), 'evergarden');
    const ids = categories.map((category) => category.id);
    expect(new Set(ids).size).toBe(ids.length);
    const planting = categories.find((category) => category.id === 'planting');
    expect(planting?.count).toBe(entries().filter((entry) => entry.group === 'planting').length);
    expect(planting?.count).toBeGreaterThan(0);
  });

  it('keeps the theme chip even when the theme names nothing', () => {
    // A theme with an empty vocabulary is exactly what the operator needs to
    // SEE; a chip that vanished when it mattered most would read as the tool
    // having no such feature at all.
    const categories = libraryCategories(propPalette(MORTAR_OVERDRIVE_PROPS, []), 'frostveil');
    expect(categories[0].id).toBe(LIBRARY_THEME_CATEGORY);
    expect(categories[0].label).toBe('frostveil');
    expect(categories[0].count).toBe(0);
  });

  it('falls back to a name when a record carries no theme id at all', () => {
    expect(libraryCategories(entries(), '   ')[0].label).toBe(LIBRARY_THEME_CATEGORY);
  });

  it('answers whether a stored choice is still offered', () => {
    const categories = libraryCategories(entries(), 'evergarden');
    expect(libraryCategoryExists(categories, LIBRARY_THEME_CATEGORY)).toBe(true);
    expect(libraryCategoryExists(categories, 'planting')).toBe(true);
    // The case it exists for: a category chosen under another theme.
    expect(libraryCategoryExists(categories, 'glacier')).toBe(false);
  });
});

describe('what the grid shows', () => {
  const filter = (category: string, search = '') => filterLibrary(entries(), { category, search });

  it('shows the THEME category and nothing else in it', () => {
    // The operator's ask, asserted as a set rather than a count: a filter that
    // returned four of the wrong pieces would pass a length check.
    const shown = filter(LIBRARY_THEME_CATEGORY).map((entry) => entry.asset);
    expect([...shown].sort()).toEqual([...GARDEN].sort());
    expect(shown.length).toBeLessThan(entries().length);
  });

  it('shows the whole catalog under all, and one group under a group', () => {
    expect(filter(LIBRARY_ALL_CATEGORY)).toHaveLength(entries().length);
    const planting = filter('planting');
    expect(planting.length).toBeGreaterThan(0);
    for (const entry of planting) expect(entry.group).toBe('planting');
  });

  it('lets a search reach PAST the category it was typed in', () => {
    // The rule the flow depends on: typing "lantern" while the theme chip is on
    // means "find me the lantern", not "find me the lantern if this zone owns
    // one". A search that only narrowed the chip would answer nothing while
    // looking like it worked.
    const notThemed = propPalette(MORTAR_OVERDRIVE_PROPS, ['oak']);
    const shown = filterLibrary(notThemed, {
      category: LIBRARY_THEME_CATEGORY,
      search: 'bench',
    }).map((entry) => entry.asset);
    expect(shown).toContain('bench');
    expect(notThemed.find((entry) => entry.asset === 'bench')?.featured).toBe(false);
  });

  it('matches the key or its group, case and space insensitively', () => {
    expect(filter(LIBRARY_ALL_CATEGORY, '  LANT ').map((e) => e.asset)).toContain('postLantern');
    const byGroup = filter(LIBRARY_ALL_CATEGORY, 'ironwork');
    expect(byGroup.length).toBeGreaterThan(0);
    for (const entry of byGroup) expect(entry.group).toBe('ironwork');
  });

  it('returns a copy on every arm, so sorting the grid cannot reorder the catalog', () => {
    for (const filter of [
      { category: LIBRARY_ALL_CATEGORY, search: '' },
      { category: LIBRARY_THEME_CATEGORY, search: '' },
      { category: 'planting', search: '' },
      { category: LIBRARY_ALL_CATEGORY, search: 'bed' },
    ]) {
      const source = entries();
      const shown = filterLibrary(source, filter);
      expect(shown.length).toBeGreaterThan(0);
      shown.reverse();
      expect(source.map((entry) => entry.asset)).toEqual(entries().map((entry) => entry.asset));
    }
  });

  it('names the way out when nothing matches, rather than showing an empty box', () => {
    expect(libraryEmptyText({ category: LIBRARY_ALL_CATEGORY, search: 'zzz' })).toContain('zzz');
    expect(libraryEmptyText({ category: LIBRARY_THEME_CATEGORY, search: '' })).toContain(
      'another category',
    );
    expect(libraryEmptyText({ category: 'planting', search: '' })).toBe('nothing in this category');
  });

  it('says how much it is holding, in the singular when it is one', () => {
    expect(librarySearchPlaceholder(27)).toBe('search 27 assets');
    expect(librarySearchPlaceholder(1)).toBe('search 1 asset');
    expect(librarySearchPlaceholder(0)).toBe('search 0 assets');
  });
});
