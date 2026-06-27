// One navigation tree drives the sidebar, default section destinations, breadcrumbs,
// and route validation. Detail-only routes such as IP associations stay outside this
// tree and attach themselves to the relevant parent trail.
export type AdminPage =
  | 'overview'
  | 'usage'
  | 'moderation'
  | 'chat-filter'
  | 'blocked-ips'
  | 'bug-reports';

export interface AdminNavItem {
  id: AdminPage;
  labelKey: string;
}

export interface AdminNavSection {
  id: string;
  labelKey?: string;
  defaultPage: AdminPage;
  items: readonly AdminNavItem[];
}

export const NAV_SECTIONS: readonly AdminNavSection[] = [
  {
    id: 'dashboard',
    defaultPage: 'overview',
    items: [{ id: 'overview', labelKey: 'nav.overview' }],
  },
  {
    id: 'operations',
    labelKey: 'nav.operations',
    defaultPage: 'usage',
    items: [{ id: 'usage', labelKey: 'nav.usage' }],
  },
  {
    id: 'moderation',
    labelKey: 'nav.moderation',
    defaultPage: 'moderation',
    items: [
      { id: 'moderation', labelKey: 'nav.reports' },
      { id: 'blocked-ips', labelKey: 'nav.blockedIps' },
      { id: 'chat-filter', labelKey: 'nav.chatFilter' },
    ],
  },
  {
    id: 'support',
    labelKey: 'nav.support',
    defaultPage: 'bug-reports',
    items: [{ id: 'bug-reports', labelKey: 'nav.bugReports' }],
  },
];

export const PAGES: readonly AdminNavItem[] = NAV_SECTIONS.flatMap((section) => section.items);

export function itemForPage(page: AdminPage): AdminNavItem {
  return PAGES.find((item) => item.id === page)!;
}
