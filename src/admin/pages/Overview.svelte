<script lang="ts">
  import { onMount } from 'svelte';
  import type {
    AccountDetail as AccountDetailData,
    AccountRow,
    Activity,
    BarPoint,
    CharacterRow,
    LinePoint,
    LivePlayer,
    OnlineHistory,
    OnlineHistoryRange,
    Overview,
    Paginated,
  } from '../types';
  import { apiGet } from '../api';
  import { auth } from '../state/auth.svelte';
  import { ACTIVITY_REFRESH_MS, LIVE_REFRESH_MS, SEARCH_DEBOUNCE_MS, poll } from '../state/poll';
  import { classLabel, t } from '../i18n';
  import {
    fmtBytes,
    fmtChartBucket,
    fmtDate,
    fmtDuration,
    fmtNumber,
    fmtRelative,
  } from '../format';
  import Panel from '../components/Panel.svelte';
  import StatCard from '../components/StatCard.svelte';
  import Badge from '../components/Badge.svelte';
  import Pager from '../components/Pager.svelte';
  import BarChart from '../components/BarChart.svelte';
  import LineChart from '../components/LineChart.svelte';
  import OnlineTable from '../components/OnlineTable.svelte';
  import CharactersTable from '../components/CharactersTable.svelte';
  import AccountDetail from './AccountDetail.svelte';

  // Overview tab: live stats + online players (5s), activity charts (60s), the
  // accounts browser (search/paginate, expandable detail) and the characters browser
  // (sort/paginate). Ported from the old refreshLive/refreshActivity/refreshAccounts/
  // refreshCharacters + toggleAccountDetail flow.
  const ONLINE_HISTORY_RANGES: OnlineHistoryRange[] = ['24h', '7d', '30d'];

  let overview = $state<Overview | null>(null);
  let online = $state<LivePlayer[]>([]);
  let activity = $state<Activity | null>(null);
  let onlineHistory = $state<OnlineHistory | null>(null);
  let onlineHistoryRange = $state<OnlineHistoryRange>('24h');

  let accounts = $state<Paginated<AccountRow> | null>(null);
  let accountsFailed = $state(false);
  let accSearch = $state('');
  let accPage = $state(1);
  let expandedId = $state<number | null>(null);
  let expandedDetail = $state<AccountDetailData | null>(null);

  let characters = $state<Paginated<CharacterRow> | null>(null);
  let charactersFailed = $state(false);
  let charSort = $state('level');
  let charDir = $state<'asc' | 'desc'>('desc');
  let charPage = $state(1);

  const dayLabel = (day: string) => day.slice(5); // YYYY-MM-DD -> MM-DD
  let registrationPoints = $derived<BarPoint[]>((activity?.registrations ?? []).map((p) => ({ label: dayLabel(p.day), value: p.count })));
  let sessionPoints = $derived<BarPoint[]>(
    (activity?.sessions ?? []).map((p) => ({
      label: dayLabel(p.day),
      value: p.sessions,
      title: t('charts.sessionsTooltip', { day: p.day, sessions: p.sessions, accounts: p.uniqueAccounts, played: fmtDuration(p.playtimeSeconds) }),
    })),
  );
  let classPoints = $derived<BarPoint[]>((activity?.classes ?? []).map((p) => ({ label: classLabel(p.key), value: p.count })));
  let levelPoints = $derived<BarPoint[]>((activity?.levels ?? []).map((p) => ({ label: p.key, value: p.count })));
  let onlinePoints = $derived<LinePoint[]>(
    (onlineHistory?.points ?? []).map((point) => ({
      label: fmtChartBucket(point.bucketStart, onlineHistory?.bucket ?? 'hour'),
      value: point.peakSiteUsers,
      secondaryValue: point.peakPlayers,
      title: t('charts.onlineTooltip', {
        bucket: fmtChartBucket(point.bucketStart, onlineHistory?.bucket ?? 'hour'),
        siteUsers: fmtNumber(point.peakSiteUsers),
        players: fmtNumber(point.peakPlayers),
        accounts: fmtNumber(point.peakAccounts),
      }),
    })),
  );

  async function refreshLive(): Promise<void> {
    try {
      const [ov, on] = await Promise.all([
        apiGet<Overview>('/admin/api/overview'),
        apiGet<{ players: LivePlayer[] }>('/admin/api/online'),
      ]);
      overview = ov;
      online = on.players;
    } catch (err) {
      if (!auth.handleAuthFailure(err)) console.error('live refresh failed:', err);
    }
  }

  async function refreshActivity(): Promise<void> {
    try {
      const [nextActivity, nextOnlineHistory] = await Promise.all([
        apiGet<Activity>('/admin/api/activity'),
        apiGet<OnlineHistory>(`/admin/api/online-history?range=${onlineHistoryRange}`),
      ]);
      activity = nextActivity;
      onlineHistory = nextOnlineHistory;
    } catch (err) {
      if (!auth.handleAuthFailure(err)) console.error('activity refresh failed:', err);
    }
  }

  async function refreshAccounts(): Promise<void> {
    try {
      const params = new URLSearchParams({ page: String(accPage), search: accSearch });
      accounts = await apiGet<Paginated<AccountRow>>(`/admin/api/accounts?${params}`);
      accountsFailed = false;
    } catch (err) {
      if (!auth.handleAuthFailure(err)) accountsFailed = true;
    }
  }

  async function refreshCharacters(): Promise<void> {
    try {
      const params = new URLSearchParams({ page: String(charPage), sort: charSort, dir: charDir });
      characters = await apiGet<Paginated<CharacterRow>>(`/admin/api/characters?${params}`);
      charactersFailed = false;
    } catch (err) {
      if (!auth.handleAuthFailure(err)) charactersFailed = true;
    }
  }

  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  function onSearchInput(e: Event): void {
    accSearch = (e.currentTarget as HTMLInputElement).value.trim();
    accPage = 1;
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => void refreshAccounts(), SEARCH_DEBOUNCE_MS);
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
    void refreshAccounts();
  }

  function onSort(col: string): void {
    charDir = charSort === col && charDir === 'desc' ? 'asc' : 'desc';
    charSort = col;
    charPage = 1;
    void refreshCharacters();
  }

  function selectOnlineHistoryRange(range: OnlineHistoryRange): void {
    onlineHistoryRange = range;
    void refreshActivity();
  }

  function suspendedSoon(a: AccountRow): boolean {
    return a.suspendedUntil !== null && new Date(a.suspendedUntil).getTime() > Date.now();
  }

  onMount(() => {
    void refreshAccounts();
    void refreshCharacters();
    const stopLive = poll(refreshLive, LIVE_REFRESH_MS);
    const stopActivity = poll(refreshActivity, ACTIVITY_REFRESH_MS);
    return () => {
      stopLive();
      stopActivity();
      if (searchTimer) clearTimeout(searchTimer);
    };
  });
</script>

<section id="stats">
  {#if overview}
    <StatCard value={fmtNumber(overview.server.online)} label={t('stats.onlineNow')} />
    <StatCard value={fmtNumber(overview.server.onlineAccounts)} label={t('stats.onlineAccounts')} />
    <StatCard value={fmtNumber(overview.siteUsersNow)} label={t('stats.siteUsersNow')} />
    <StatCard value={fmtNumber(overview.peakOnlineToday)} label={t('stats.peakOnlineToday')} />
    <StatCard value={fmtNumber(overview.peakOnlineAllTime)} label={t('stats.peakOnlineAllTime')} />
    <StatCard value={fmtNumber(overview.activeAccountsToday)} label={t('stats.activeAccounts24h')} />
    <StatCard value={fmtNumber(overview.activeAccountsWeek)} label={t('stats.activeAccounts7d')} />
    <StatCard value={fmtNumber(overview.activeAccountsMonth)} label={t('stats.activeAccounts30d')} />
    <StatCard value={fmtNumber(overview.accountsToday)} label={t('stats.newAccounts24h')} />
    <StatCard value={fmtNumber(overview.returningAccountsToday)} label={t('stats.returningAccounts24h')} />
    <StatCard value={fmtDuration(overview.avgPlaytimeSeconds)} label={t('stats.avgPlaytimePerAccount')} />
    <StatCard value={fmtNumber(overview.accounts)} label={t('stats.accounts')} />
    <StatCard value={fmtNumber(overview.characters)} label={t('stats.characters')} />
    <StatCard value={fmtNumber(overview.sessionsToday)} label={t('stats.sessions24h')} />
    <StatCard value={fmtDuration(overview.server.uptimeSeconds)} label={t('stats.uptime')} />
    <StatCard value={`${fmtNumber(overview.server.tickMsAvg)} ms`} label={t('stats.avgTick')} />
    <StatCard value={fmtBytes(overview.server.rssBytes)} label={t('stats.serverRss')} />
  {/if}
</section>

<Panel title={t('online.title')} hint={t('online.refreshHint')}>
  <OnlineTable players={online} />
</Panel>

<section id="charts">
  <Panel
    title={t('charts.onlineHistory', {
      range: t(`charts.range.${onlineHistory?.range ?? onlineHistoryRange}`),
    })}
  >
    <div class="range-tabs">
      {#each ONLINE_HISTORY_RANGES as range}
        <button
          type="button"
          class:active={onlineHistoryRange === range}
          class="range-tab"
          aria-pressed={onlineHistoryRange === range}
          onclick={() => selectOnlineHistoryRange(range)}
        >
          {t(`charts.range.${range}`)}
        </button>
      {/each}
    </div>
    <LineChart points={onlinePoints} />
  </Panel>
  <Panel title={t('charts.registrations', { days: activity?.days ?? 0 })}>
    <BarChart points={registrationPoints} />
  </Panel>
  <Panel title={t('charts.sessions', { days: activity?.days ?? 0 })}>
    <BarChart points={sessionPoints} />
  </Panel>
  <Panel title={t('charts.classDistribution')}>
    <BarChart points={classPoints} />
  </Panel>
  <Panel title={t('charts.levelDistribution')}>
    <BarChart points={levelPoints} />
  </Panel>
</section>

<Panel title={t('accounts.title')}>
  <div class="controls">
    <input id="account-search" placeholder={t('accounts.searchPlaceholder')} value={accSearch} oninput={onSearchInput} />
    {#if accounts}
      <div class="pager"><Pager total={accounts.total} page={accounts.page} limit={accounts.limit} onPage={(p) => { accPage = p; void refreshAccounts(); }} /></div>
    {/if}
  </div>
  {#if accountsFailed}
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
        {#each accounts.rows as a (a.id)}
          <tr class="clickable" onclick={() => toggleAccount(a.id)}>
            <td class="num">{a.id}</td>
            <td>
              {a.username}{#if a.isAdmin} <Badge>{t('accounts.badgeAdmin')}</Badge>{/if}
              {#if a.bannedAt} <Badge variant="bad">{t('accounts.badgeBanned')}</Badge>{:else if suspendedSoon(a)} <Badge variant="warn">{t('accounts.badgeSuspended')}</Badge>{/if}
            </td>
            <td class="num">{a.characterCount}</td>
            <td class="num">{a.maxLevel}</td>
            <td class="num">{fmtDuration(a.playtimeSeconds)}</td>
            <td>{fmtDate(a.createdAt)}</td>
            <td>{fmtRelative(a.lastLogin)}</td>
          </tr>
          {#if expandedId === a.id && expandedDetail}
            <tr class="detail-row">
              <td colspan="7"><AccountDetail detail={expandedDetail} includeAdminControls onChanged={onAccountChanged} /></td>
            </tr>
          {/if}
        {/each}
      </tbody>
    </table>
  {/if}
</Panel>

<Panel title={t('characters.title')} hint={t('characters.sortHint')}>
  <div class="controls">
    {#if characters}
      <div class="pager"><Pager total={characters.total} page={characters.page} limit={characters.limit} onPage={(p) => { charPage = p; void refreshCharacters(); }} /></div>
    {/if}
  </div>
  {#if charactersFailed}
    <div class="empty">{t('characters.loadFailed')}</div>
  {:else if characters}
    <CharactersTable rows={characters.rows} sort={charSort} dir={charDir} {onSort} />
  {/if}
</Panel>
