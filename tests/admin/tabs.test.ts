// @vitest-environment jsdom
import './_setup';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import Tabs from '../../src/admin/components/Tabs.svelte';
import { t } from '../../src/admin/i18n';
import { PAGES } from '../../src/admin/pages/pages';

describe('Tabs', () => {
  it('renders every tab and marks the active one', () => {
    render(Tabs, { pages: PAGES, active: 'overview', onSelect: () => {} });
    for (const p of PAGES) expect(screen.getByText(t(p.labelKey))).toBeInTheDocument();
    expect(screen.getByText(t('nav.overview')).classList.contains('active')).toBe(true);
    expect(screen.getByText(t('nav.usage')).classList.contains('active')).toBe(false);
  });

  it('calls onSelect with the clicked page id', async () => {
    const onSelect = vi.fn();
    render(Tabs, { pages: PAGES, active: 'overview', onSelect });
    await fireEvent.click(screen.getByText(t('nav.moderation')));
    expect(onSelect).toHaveBeenCalledWith('moderation');
  });
});
