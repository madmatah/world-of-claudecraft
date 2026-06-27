<script lang="ts">
  import { onMount } from 'svelte';
  import type {
    AccountDetail as AccountDetailData,
    AccountRow,
    Paginated,
  } from '../types';
  import { apiGet } from '../api';
  import { auth } from '../state/auth.svelte';
  import { SEARCH_DEBOUNCE_MS } from '../state/poll';
  import { t } from '../i18n';
  import { fmtDate, fmtDuration, fmtRelative } from '../format';
  import Panel from '../components/Panel.svelte';
  import Badge from '../components/Badge.svelte';
  import Pager from '../components/Pager.svelte';
  import AccountDetail from './AccountDetail.svelte';

  let accounts = $state<Paginated<AccountRow> | null>(null);
  let failed = $state(false);
  let search = $state('');
  let page = $state(1);
  let expandedId = $state<number | null>(null);
  let expandedDetail = $state<AccountDetailData | null>(null);
  let searchTimer: ReturnType<typeof setTimeout> | null = null;

  async function refresh(): Promise<void> {
    try {
      const params = new URLSearchParams({ page: String(page), search });
      accounts = await apiGet<Paginated<AccountRow>>(`/admin/api/accounts?${params}`);
      failed = false;
    } catch (err) {
      if (!auth.handleAuthFailure(err)) failed = true;
    }
  }

  function onSearchInput(event: Event): void {
    search = (event.currentTarget as HTMLInputElement).value.trim();
    page = 1;
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => void refresh(), SEARCH_DEBOUNCE_MS);
  }

  async function refreshExpandedDetail(): Promise<void> {
    if (expandedId === null) return;
    try {
      expandedDetail = await apiGet<AccountDetailData>(`/admin/api/accounts/${expandedId}`);
    } catch (err) {
      if (!auth.handleAuthFailure(err)) console.error('account detail failed:', err);
    }
  }

  async function toggleAccount(id: number): Promise<void> {
    if (expandedId === id) {
      expandedId = null;
      expandedDetail = null;
      return;
    }
    expandedId = id;
    expandedDetail = null;
    await refreshExpandedDetail();
  }

  function onAccountChanged(): void {
    void refreshExpandedDetail();
    void refresh();
  }

  function suspendedSoon(account: AccountRow): boolean {
    return (
      account.suspendedUntil !== null &&
      new Date(account.suspendedUntil).getTime() > Date.now()
    );
  }

  onMount(() => {
    void refresh();
    return () => {
      if (searchTimer) clearTimeout(searchTimer);
    };
  });
</script>

<Panel>
  <div class="controls">
    <input
      id="account-search"
      placeholder={t('accounts.searchPlaceholder')}
      value={search}
      oninput={onSearchInput}
    />
    {#if accounts}
      <div class="pager">
        <Pager
          total={accounts.total}
          page={accounts.page}
          limit={accounts.limit}
          onPage={(nextPage) => {
            page = nextPage;
            void refresh();
          }}
        />
      </div>
    {/if}
  </div>
  {#if failed}
    <div class="empty">{t('accounts.loadFailed')}</div>
  {:else if accounts && accounts.rows.length === 0}
    <div class="empty">{t('accounts.empty')}</div>
  {:else if accounts}
    <table>
      <thead>
        <tr>
          <th class="num">{t('accounts.colId')}</th>
          <th>{t('accounts.colUsername')}</th>
          <th class="num">{t('accounts.colChars')}</th>
          <th class="num">{t('accounts.colMaxLvl')}</th>
          <th class="num">{t('accounts.colPlaytime')}</th>
          <th>{t('accounts.colRegistered')}</th>
          <th>{t('accounts.colLastLogin')}</th>
        </tr>
      </thead>
      <tbody>
        {#each accounts.rows as account (account.id)}
          <tr class="clickable" onclick={() => toggleAccount(account.id)}>
            <td class="num">{account.id}</td>
            <td>
              {account.username}
              {#if account.isAdmin}<Badge>{t('accounts.badgeAdmin')}</Badge>{/if}
              {#if account.bannedAt}
                <Badge variant="bad">{t('accounts.badgeBanned')}</Badge>
              {:else if suspendedSoon(account)}
                <Badge variant="warn">{t('accounts.badgeSuspended')}</Badge>
              {/if}
            </td>
            <td class="num">{account.characterCount}</td>
            <td class="num">{account.maxLevel}</td>
            <td class="num">{fmtDuration(account.playtimeSeconds)}</td>
            <td>{fmtDate(account.createdAt)}</td>
            <td>{fmtRelative(account.lastLogin)}</td>
          </tr>
          {#if expandedId === account.id && expandedDetail}
            <tr class="detail-row">
              <td colspan="7">
                <AccountDetail
                  detail={expandedDetail}
                  includeAdminControls
                  onChanged={onAccountChanged}
                />
              </td>
            </tr>
          {/if}
        {/each}
      </tbody>
    </table>
  {/if}
</Panel>
