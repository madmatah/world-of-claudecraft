// The six admin tabs. Shared by App.svelte (routing) and Tabs.svelte (nav bar). Order
// matches the old admin.html nav. labelKey is an admin en i18n key.
export type AdminPage =
  | 'overview'
  | 'usage'
  | 'moderation'
  | 'chat-filter'
  | 'blocked-ips'
  | 'bug-reports';

export const PAGES: readonly { id: AdminPage; labelKey: string }[] = [
  { id: 'overview', labelKey: 'nav.overview' },
  { id: 'usage', labelKey: 'nav.usage' },
  { id: 'moderation', labelKey: 'nav.moderation' },
  { id: 'chat-filter', labelKey: 'nav.chatFilter' },
  { id: 'blocked-ips', labelKey: 'nav.blockedIps' },
  { id: 'bug-reports', labelKey: 'nav.bugReports' },
];
